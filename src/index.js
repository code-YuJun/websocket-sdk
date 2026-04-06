import { LRUCache } from 'lru-cache'

const cache = new LRUCache({
  max: 10000,
  ttl: 3 * 60 * 1000 // 过期时间，单位为毫秒
})

const maxAttempts = 100

const defaultEvent = {
  onError: (evt) => console.error('WebSocket Error:', evt),
  onOpen: (evt) => console.log('WebSocket Opened:', evt),
  onClose: (evt) => console.log('WebSocket Closed:', evt)
}

class WsSocket {
  constructor(urlCallBack, events) {
    this.connect = null
    this.urlCallBack = urlCallBack
    this.events = { ...defaultEvent, ...events }
    this.onCallBacks = {}
    this.lastTime = 0
    this.config = {
      heartbeat: {
        setInterval: null,
        pingInterval: 20000,
        pingTimeout: 60000
      },
      reconnect: {
        lockReconnect: false,
        setTimeout: null,
        interval: [2000, 2500, 3000, 3000, 5000, 8000], // Exponential backoff
        attempts: maxAttempts
      }
    }
  }

  /**
   * 绑定自定义事件回调
   */
  on(event, callback) {
    this.onCallBacks[event] = callback
    return this
  }

  /**
   * 初始化 WebSocket 实例
   */
  loadSocket() {
    this.connect = new WebSocket(this.urlCallBack())
    // this.connect.binaryType = 'arraybuffer'
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
    if (this.config.reconnect.lockReconnect || this.config.reconnect.attempts <= 0) return

    this.config.reconnect.lockReconnect = true
    this.config.reconnect.attempts--

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
    this.lastTime = Date.now()

    this.events.onOpen?.(evt)

    this.config.reconnect.interval = [1000, 1000, 3000, 5000, 10000]
    this.config.reconnect.lockReconnect = false
    this.config.reconnect.attempts = maxAttempts

    this.heartbeat()
  }

  /**
   * WebSocket 关闭事件处理
   */
  onClose(evt) {
    this.events.onClose?.(evt)
    this.connect = null

    if (this.config.heartbeat.setInterval) {
      clearInterval(this.config.heartbeat.setInterval)
    }

    this.config.reconnect.lockReconnect = false

    if (evt.code !== 1000) {
      this.reconnect()
    }
  }

  /**
   * WebSocket 错误事件处理
   */
  onError(evt) {
    this.events.onError?.(evt)
  }

  /**
   * 接收消息处理
   */
  onMessage(evt) {
    this.lastTime = Date.now()

    const data = this.onParse(evt)

    if (data.event === 'pong') {
      return
    }

    if (data.ackid) {
      this.connect?.send(`{"event":"ack","ackid":"${data.ackid}"}`)

      if (cache.has(data.ackid)) return

      cache.set(data.ackid, true)
    }

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
    }, this.config.heartbeat.pingInterval)
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
