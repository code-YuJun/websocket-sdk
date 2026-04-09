// 获取 token
const getToken = () => {
  return localStorage.getItem('AccessToken') || ''
}

// 判断是否登录
const isLogin = () => {
  return getToken() !== ''
}

// 获取连接地址
const urlCallback = () => {
  if (!isLogin()) {
    window.location.reload()
  }
  return `ws://124.222.6.60:8800?token=${getToken()}`
}

class Connect {
  constructor() {
    this.conn = new WsSocket(urlCallback, {
      onError: () => {
        console.error('WebSocket 连接失败:')
      },
      onOpen: () => {
        // 设置用户在线状态
        useUserStore().updateSocketStatus(true)
        // 加载聊天列表
        useTalkStore().loadTalkList()
      },
      onClose: () => {
        // 设置用户离线状态
        useUserStore().updateSocketStatus(false)
      }
    })
    // 绑定事件
    this.bindEvents()
  }
  // 连接
  connect() {
    this.conn.connection()
  }
  // 断开连接
  disconnect() {
    this.conn.close()
  }
  // 判断是否连接成功
  isConnect() {
    return this.conn.connect?.readyState === WebSocket.OPEN
  }

  emit(event, data) {
    this.conn.emit(event, data)
  }

  bindEvents() {
    this.onPing()
    this.onPong()
    this.onImMessage()
    this.onImMessageKeyboard()
    this.onImMessageRevoke()
    this.onImContactApply()
    this.onImGroupApply()
    this.onEventError()
  }

  onPing() {
    this.conn.on('ping', () => this.emit('pong', null))
  }

  onPong() {
    this.conn.on('pong', () => {})
    this.conn.on('connect', () => {})
  }

  onImMessage() {
    this.conn.on('im.message', (data) => new EventTalk(data))
  }

  onImMessageKeyboard() {
    this.conn.on('im.message.keyboard', (data) => new EventKeyboard(data))
  }

  onImMessageRevoke() {
    this.conn.on('im.message.revoke', (data) => new EventRevoke(data))
  }

}

// 导出单例
export default new Connect()