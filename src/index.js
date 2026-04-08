// 引入 LRU 缓存库，用于存储已处理的消息 ID，防止重复处理
import { LRUCache } from 'lru-cache'

// 实例化缓存：最大存储 10000 条，每条数据 3 分钟后过期
const cache = new LRUCache({
  max: 10000,
  ttl: 3 * 60 * 1000 // 过期时间，单位为毫秒
})

// 最大重连尝试次数
const maxAttempts = 100

// 默认的事件钩子，防止用户未传回调时报错
const defaultEvent = {
  onError: (evt) => console.error('WebSocket Error:', evt),
  onOpen: (evt) => console.log('WebSocket Opened:', evt),
  onClose: (evt) => console.log('WebSocket Closed:', evt)
}

class WsSocket {
  constructor(urlCallBack, events) {
    this.connect = null // 原生 WebSocket 实例对象
    this.urlCallBack = urlCallBack // 获取 URL 的函数（动态获取，方便重连时可能更新 Token）
    this.events = { ...defaultEvent, ...events } // 合并用户自定义事件
    this.onCallBacks = {} // 存储业务层通过 .on() 绑定的自定义事件
    this.lastTime = 0 // 最后一次收到消息的时间戳
    this.config = {
      // 心跳配置
      heartbeat: {
        setInterval: null,   // 心跳定时器 ID
        pingInterval: 20000, // 每 20 秒发送一次 ping
        pingTimeout: 60000   // 超时阈值
      },
      // 重连配置
      reconnect: {
        lockReconnect: false, // 互斥锁，防止同时触发多次重连
        setTimeout: null,     // 重连定时器 ID
        interval: [2000, 2500, 3000, 3000, 5000, 8000], // 递增重连等待时间
        attempts: maxAttempts // 最大重连尝试次数
      }
    }
  }
  /**
   * 绑定自定义事件回调
   */
  on(event, callback) {
    this.onCallBacks[event] = callback
    return this // 支持链式调用
  }
  /**
   * 初始化 WebSocket 实例
   */
  loadSocket() {
    this.connect = new WebSocket(this.urlCallBack())
    // 绑定事件
    this.connect.onerror = this.onError.bind(this)
    this.connect.onopen = this.onOpen.bind(this)
    this.connect.onmessage = this.onMessage.bind(this)
    this.connect.onclose = this.onClose.bind(this)
  }
  /**
   * 建立连接
   */
  connection() {
    if (this.connect === null) {
      this.loadSocket()
    }
  }
  /**
   * 重连逻辑
   */
  reconnect() {
    // 如果重连锁开启或次数用尽，则停止
    if (this.config.reconnect.lockReconnect || this.config.reconnect.attempts <= 0) return

    this.config.reconnect.lockReconnect = true // 加锁
    this.config.reconnect.attempts-- // 减少重连尝试次数

    // 从数组中弹出第一个 等待时间 ，如果没有了，默认等待 10 秒
    const delay = this.config.reconnect.interval.shift()

    this.config.reconnect.setTimeout = setTimeout(() => {
      console.log(new Date().toLocaleString(), 'Attempting to reconnect to WebSocket...')
      this.connection()
    }, delay || 10000)
  }
  /**
   * 解析消息
   */
  onParse(evt) {
    return JSON.parse(evt.data)
  }
  /**
   * WebSocket 打开事件处理
   */
  onOpen(evt) {
    this.lastTime = Date.now() // 链接活跃时间赋值
    // 执行用户传入的 onOpen
    this.events.onOpen?.(evt)
    // 连接成功后重置重连配置
    this.config.reconnect.interval = [1000, 1000, 3000, 5000, 10000]
    this.config.reconnect.lockReconnect = false
    this.config.reconnect.attempts = maxAttempts

    this.heartbeat() // 启动心跳机制
  }
  /**
   * WebSocket 关闭事件处理
   */
  onClose(evt) {
    // 执行用户传入的 onClose
    this.events.onClose?.(evt)
    this.connect = null

    if (this.config.heartbeat.setInterval) {
      clearInterval(this.config.heartbeat.setInterval)
    }
    this.config.reconnect.lockReconnect = false
    // 如果 code 为 1000 表示正常关闭，否则是非正常关闭，触发自动重连
    if (evt.code !== 1000) {
      this.reconnect()
    }
  }
  /**
   * WebSocket 错误事件处理
   */
  onError(evt) {
    // 执行用户传入的 onError
    this.events.onError?.(evt)
  }
  /**
   * 接收消息处理
   */
  onMessage(evt) {
    this.lastTime = Date.now() // 无论是业务消息还是 Pong，更新活跃时间
    const data = this.onParse(evt)

    if (data.event === 'pong') return // 收到服务端响应的 pong，不做处理

    // ACK 确认机制：如果服务器发来的消息带 ackid
    if (data.ackid) {
      // 1. 立即给服务器回复一个 ack 包，告诉服务器“我收到了”
      this.connect?.send(`{"event":"ack","ackid":"${data.ackid}"}`)
      // 2. 幂等检查：如果在 LRU 缓存里已经有这个 ID，说明是重复投递，直接拦截
      if (cache.has(data.ackid)) return
      cache.set(data.ackid, true) // 存入缓存
    }
    
    // 业务分发：根据 event 名称寻找对应的 .on() 回调
    if (this.onCallBacks[data.event]) {
      this.onCallBacks[data.event](data.payload, evt.data)
    } else {
      console.warn(`WsSocket message event [${data.event}] not bound...`)
    }
  }
  /**
   * 心跳机制
   */
  heartbeat() {
    if (this.config.heartbeat.setInterval) {
      clearInterval(this.config.heartbeat.setInterval)
    }

    this.config.heartbeat.setInterval = setInterval(() => {
      this.ping()
      this.checkServerAlive(); // 每发一次 ping，启动一个超时检查
    }, this.config.heartbeat.pingInterval)
  }
  /**
   * 检查服务端是否还活着
   */
  checkServerAlive() {
    // 如果当前时间距离上次收到消息的时间超过了 pingTimeout
    const now = Date.now();
    if (now - this.lastTime > this.config.heartbeat.pingTimeout) {
      console.warn('WebSocket heartbeat timeout, closing...');
      this.connect.close(); // 主动关闭，触发 onClose 进而触发重连
    }
  }
  /**
   * 发送心跳包
   */
  ping() {
    this.connect?.send(JSON.stringify({ event: 'ping' }))
  }
  /**
   * 发送数据
   */
  send(message) {
    if (this.connect && this.connect.readyState === WebSocket.OPEN) {
      this.connect.send(typeof message === 'string' ? message : JSON.stringify(message))
    } else {
      alert('WebSocket 连接已关闭')
    }
  }
  /**
   * 主动关闭连接
   */
  close() {
    this.connect?.close()
    // 关闭心跳
    if (this.config.heartbeat.setInterval) {
      clearInterval(this.config.heartbeat.setInterval)
    }
  }
  /**
   * 发送自定义事件
   */
  emit(event, payload) {
    if (this.connect && this.connect.readyState === WebSocket.OPEN) {
      this.connect.send(JSON.stringify({ event, payload }))
    } else {
      console.error('WebSocket connection closed...', this.connect)
    }
  }
}
export default WsSocket
