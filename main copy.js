const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  Tray,
  Menu,
} = require("electron");
const path = require("path");
const sharp = require("sharp");

let mainWindow;
let tray = null; // 托盘图标变量
let reqId = "";
let flashInterval = null; // 闪烁间隔变量
let messageCount = 0; // 新消息数量

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

// 生成带有背景色的任务栏图标
async function generateBackgroundIcon() {
  const originalIconPath = path.join(__dirname, "icon.ico");
  const outputPath = path.join(__dirname, "icon-background.png");

  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: "#c06325", // 黄色背景色
    },
  })
    .composite([
      {
        input: originalIconPath,
        top: 0,
        left: 0,
      },
    ])
    .toFile(outputPath);

  return outputPath;
}

// 显示自定义的消息弹出框
function showCustomNotification(title, message, iconPath) {
  const notificationWindow = new BrowserWindow({
    width: 350,
    height: 100,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  notificationWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`
      <html>
        <head>
          <style>
            body {
              margin: 0; padding: 0; background: #ffffff; font-family: Arial, sans-serif;
            }
            .notification {
              display: flex; align-items: center; padding: 10px; border: 1px solid #ccc; border-radius: 8px;
              box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.2);
            }
            img {
              width: 50px; height: 50px; border-radius: 50%; margin-right: 15px;
            }
            h3 {
              margin: 0; font-size: 16px; color: #333;
            }
            p {
              margin: 5px 0 0; font-size: 14px; color: #666;
            }
          </style>
        </head>
        <body>
          <div class="notification">
            <img src="file://${iconPath}" alt="icon">
            <div>
              <h3>${title}</h3>
              <p>${message}</p>
            </div>
          </div>
        </body>
      </html>
    `)
  );

  notificationWindow.setPosition(100, 100); // 设置弹出框的位置，您可以根据需要调整

  setTimeout(() => {
    if (!notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }
  }, 5000); // 5 秒后关闭弹出框

  notificationWindow.on("closed", () => {
    notificationWindow.destroy();
  });

  notificationWindow.on("click", () => {
    mainWindow.show();
    notificationWindow.close();
  });
}

// 监听新消息的事件
ipcMain.on("new-message", async (event, message) => {
  if (mainWindow) {
    messageCount++;

    // 显示自定义的消息弹出框
    showCustomNotification(
      "新消息提醒",
      message,
      path.join(__dirname, "icon.ico")
    );

    // 生成带有背景色的任务栏图标
    const backgroundIconPath = await generateBackgroundIcon();
    mainWindow.setIcon(backgroundIconPath); // 更改任务栏图标为带有背景色的图标

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
