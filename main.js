const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  Tray,
  Menu,
} = require("electron");
const notifier = require("node-notifier");
const path = require("path");
const sharp = require("sharp");

let mainWindow;
let tray = null; // 托盘图标变量
let reqId = "";
let flashInterval = null; // 闪烁间隔变量
let messageCount = 0; // 新消息数量

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "icon.ico"), // 自定义图标
  });

  // 加载聊天页面的 URL
  mainWindow.loadURL("https://woa.wps.cn/im/messages#/");

  // 使用 webRequest 拦截 WebSocket 请求
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith("wss://woa.wps.cn/sub")) {
      console.log("Intercepted WebSocket URL:", details.url);
      const url = new URL(details.url);
      reqId = url.searchParams.get("req_id"); // 提取出 req_id
      console.log("Extracted req_id:", reqId);
    }
    callback({});
  });

  // 在页面加载完成后建立 WebSocket 连接
  mainWindow.webContents.on("did-finish-load", () => {
    if (reqId) {
      mainWindow.webContents.executeJavaScript(`
        const socket = new WebSocket('wss://woa.wps.cn/sub?req_id=${reqId}');
        socket.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data && data.type === 'new_message') {
            require('electron').ipcRenderer.send('new-message', data.message);
          }
        };
      `);
    }
  });

  // 初始化托盘图标
  tray = new Tray(path.join(__dirname, "icon.ico")); // 设置托盘图标
  const contextMenu = Menu.buildFromTemplate([
    { label: "打开应用", click: () => mainWindow.show() },
    { label: "退出", click: () => app.quit() },
  ]);
  tray.setToolTip("Yundoc Chat Notifier");
  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示主窗口
  tray.on("double-click", () => {
    mainWindow.show();
  });

  // 当用户查看窗口时，停止任务栏闪烁并恢复托盘图标
  mainWindow.on("focus", () => {
    messageCount = 0; // 重置消息计数
    tray.setImage(path.join(__dirname, "tray-icon.png")); // 恢复托盘图标
    mainWindow.setIcon(path.join(__dirname, "icon.ico")); // 恢复任务栏图标
    if (flashInterval) {
      clearInterval(flashInterval);
      flashInterval = null;
    }
  });
}

// 生成带有新消息数量徽章的图标
async function generateBadgeIcon(count) {
  const originalIconPath = path.join(__dirname, "icon.ico");
  const outputPath = path.join(__dirname, "icon-badge.png");

  await sharp(originalIconPath)
    .composite([
      {
        input: Buffer.from(
          `<svg width="64" height="64">
            <circle cx="48" cy="16" r="16" fill="red" />
            <text x="48" y="21" font-size="16" fill="white" text-anchor="middle" font-family="Arial" font-weight="bold">${count}</text>
          </svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .toFile(outputPath);

  return outputPath;
}

// 监听新消息的事件
ipcMain.on("new-message", async (event, message) => {
  if (mainWindow) {
    messageCount++;

    // 使用 node-notifier 显示系统通知
    notifier.notify(
      {
        title: "新消息提醒",
        message: message,
        icon: path.join(__dirname, "icon.ico"), // 自定义图标
        sound: true, // 启用声音
        wait: true, // 等待用户点击
      },
      (err, response) => {
        if (response === "activate") {
          // 用户点击了通知，显示主窗口
          mainWindow.show();
        }
      }
    );

    // 生成带有徽章的任务栏图标
    const badgeIconPath = await generateBadgeIcon(messageCount);
    mainWindow.setIcon(badgeIconPath); // 更改任务栏图标为带有徽章的图标

    // 更改托盘图标（可选择不同图标表示有新消息）
    tray.setImage(path.join(__dirname, "tray-icon-new-message.png"));

    let showOriginalIcon = true;
    if (!flashInterval) {
      flashInterval = setInterval(() => {
        if (showOriginalIcon) {
          tray.setImage(path.join(__dirname, "tray-icon-new-message.png"));
        } else {
          tray.setImage(path.join(__dirname, "tray-icon.png"));
        }
        showOriginalIcon = !showOriginalIcon;
      }, 500); // 每 500 毫秒切换一次图标
    }
  }
});

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
