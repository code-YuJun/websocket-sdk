// 引入 LRU 缓存库，用于存储已处理的消息 ID，防止服务端重复推送消息
import { LRUCache } from 'lru-cache'

// 实例化缓存：最大存储 10000 条，每条数据 3 分钟后过期
const cache = new LRUCache({
  max: 10000,
  ttl: 3 * 60 * 1000 // 过期时间，单位为毫秒
})

// 最大重连尝试次数（防止无限重连）
const maxAttempts = 100

// 默认事件兜底（防止用户没传）
const defaultEvent = {
  onError: (evt) => console.error('WebSocket Error:', evt),
  onOpen: (evt) => console.log('WebSocket Opened:', evt),
  onClose: (evt) => console.log('WebSocket Closed:', evt)
}

class WsSocket {
  constructor(urlCallBack, events) {
    this.connect = null // 原生 WebSocket 实例对象
    this.urlCallBack = urlCallBack // 获取 URL 的函数（动态获取，方便重连时可能更新 Token，否则第一次连接 OK，重连时还用旧 token）
    this.events = { ...defaultEvent, ...events } // 合并用户自定义事件
    this.onCallBacks = {} // 存 .on('xxx') 注册的业务事件
    this.lastTime = 0 // 记录最后一次收到消息时间（心跳用）
    this.config = {
      // 心跳配置
      heartbeat: {
        setInterval: null,   // 心跳定时器 ID
        // 每 20 秒发一次 ping，60 秒没响应就认为断线
        pingInterval: 20000,
        pingTimeout: 60000
      },
      // 重连配置
      reconnect: {
        lockReconnect: false, // 互斥锁，防止并发重连 见 learn.md 中的 “并发重连”
        setTimeout: null,     // 重连定时器 ID
        // interval: [2000, 2500, 3000, 3000, 5000, 8000], // 渐进式退避
        attemptIndex: 0, // 重连尝试次数索引，用于指数退避，数值表示第几次重连，从0开始
        attempts: maxAttempts // 最大重连尝试次数
      }
    }
    this.manualClose = false // 是否手动关闭连接，用于判断是否需要重连
  }
  /**
   * 绑定自定义事件回调，使用方式：ws.on('message', fn)
   */
  on(event, callback) {
    this.onCallBacks[event] = this.onCallBacks[event] || []
    this.onCallBacks[event].push(callback)
    return this
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
    // 如果 connect 还在（但 CLOSED / CLOSING），或者没有 connect 实例，都重新加载
    if (
      !this.connect ||
      this.connect.readyState === WebSocket.CLOSED ||
      this.connect.readyState === WebSocket.CLOSING
    ) {
      this.loadSocket()
    }
  }
  getDelay() {
    const n = this.config.reconnect.attemptIndex
    // 指数退避：1s, 2s, 4s, 8s... 最大 10s
    return Math.min(1000 * 2 ** n, 10000)
  }
  /**
   * 重连逻辑
   */
  reconnect() {
    if (this.config.reconnect.setTimeout) {
      clearTimeout(this.config.reconnect.setTimeout)
    }
    // 如果重连锁开启或次数用尽，则停止
    if (this.config.reconnect.lockReconnect || this.config.reconnect.attempts <= 0) return

    this.config.reconnect.lockReconnect = true // 加锁，现在已经在重连了，其重连别进来
    this.config.reconnect.attempts-- // 减少重连尝试次数

    const delay = this.getDelay()

    this.config.reconnect.setTimeout = setTimeout(() => {
      // 重连完成后，解锁，方便下一次重连
      this.config.reconnect.lockReconnect = false
      this.config.reconnect.attemptIndex++ // 重连尝试次数索引增加
      console.log(new Date().toLocaleString(), 'Attempting to reconnect to WebSocket...')
      this.connection()
    }, delay || 10000)
  }
  /**
   * 解析消息
   */
  onParse(evt) {
    try {
      return JSON.parse(evt.data)
    } catch (e) {
      console.warn('Invalid WS message:', evt.data)
      return {}
    }
  }
  /**
   * WebSocket 打开事件处理
   */
  onOpen(evt) {
    this.lastTime = Date.now() // 更新心跳时间
    // 执行用户传入的 onOpen
    this.events.onOpen?.(evt)
    // 连接成功后重置重连配置
    this.config.reconnect.attemptIndex = 0 // 重连尝试次数索引重置
    // 连接成功后，解锁，方便下一次重连
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
    // 不是异常关闭 && 且不是手动关闭连接，才触发重连
    if (evt.code !== 1000 && !this.manualClose) {
      this.reconnect()
    }
    this.manualClose = false // 重置手动关闭连接标志
  }
  /**
   * WebSocket 错误事件处理
   */
  onError(evt) {
    // 执行用户传入的 onError
    this.events.onError?.(evt)
    // 只在连接不可用时才触发重连
    if (!this.connect || this.connect.readyState !== WebSocket.OPEN) {
      this.reconnect()
    }
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
      this.connect?.send(JSON.stringify({
        event: 'ack',
        ackid: data.ackid
      }))
      // 2. 幂等检查：如果在 LRU 缓存里已经有这个 ID，说明是重复投递，直接拦截
      if (cache.has(data.ackid)) return
      cache.set(data.ackid, true) // 存入缓存
    }

    // 业务分发：根据 event 名称寻找对应的 .on() 回调
    const handlers = this.onCallBacks[data.event]
    if (handlers && handlers.length) {
      handlers.forEach(fn => fn(data.payload, evt.data))
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
      this.connect.close(4000, 'heartbeat timeout'); // 超时 → 主动 close，触发 onClose 进而触发重连
    }
  }
  /**
   * 发送心跳包
   */
  ping() {
    if (this.connect?.readyState === WebSocket.OPEN) {
      this.connect.send(JSON.stringify({ event: 'ping' }))
    }
  }
  /**
   * 发送数据
   */
  send(message) {
    if (this.connect && this.connect.readyState === WebSocket.OPEN) {
      this.connect.send(typeof message === 'string' ? message : JSON.stringify(message))
    } else {
      throw new Error('WebSocket not connected')
    }
  }
  /**
   * 主动关闭连接
   */
  close() {
    this.manualClose = true // 标记为手动关闭连接
    this.connect?.close() // 主动关闭连接
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
