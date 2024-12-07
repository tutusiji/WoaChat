// main.js

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  session,
} = require("electron");
const path = require("path");
const notifier = require("node-notifier");

let mainWindow;
let notificationWindow;
let tray = null;
let reqId = "";
let messageCount = 0;
let didFinishLoad = false;

// 创建主应用窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // 或 notificationPreload.js
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "icon.ico"), // 自定义图标
  });

  // 加载聊天页面的 URL
  mainWindow.loadURL("https://woa.wps.cn/im/messages#/");

  // 使用 webRequest 拦截 WebSocket 请求，提取 req_id
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith("wss://woa.wps.cn/sub")) {
      console.log("Intercepted WebSocket URL:", details.url);
      const urlObj = new URL(details.url);
      reqId = urlObj.searchParams.get("req_id"); // 提取出 req_id
      console.log("Extracted req_id:", reqId);
      injectWebSocketScript(); // 尝试注入 WebSocket 脚本
    }
    callback({});
  });

  // 在页面加载完成后
  mainWindow.webContents.on("did-finish-load", () => {
    didFinishLoad = true;
    injectWebSocketScript(); // 尝试注入 WebSocket 脚本
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

  // 当用户查看窗口时，重置消息计数
  mainWindow.on("focus", () => {
    messageCount = 0; // 重置消息计数
  });
}

// 创建通知窗口（仅在有新消息时创建）
function createNotificationWindow() {
  if (notificationWindow) {
    console.log("Notification window already exists.");
    return;
  }

  console.log("Creating notification window.");
  notificationWindow = new BrowserWindow({
    width: 300,
    height: 400,
    x: 100,
    y: 100,
    frame: true, // 显示窗口边框和标题栏
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "notificationPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notificationWindow
    .loadFile("notification.html")
    .then(() => {
      console.log(
        "Notification window loaded 'notification.html' successfully."
      );
      // 显示窗口
      notificationWindow.show();
      notificationWindow.focus();
    })
    .catch((error) => {
      console.error("Failed to load 'notification.html':", error);
    });

  notificationWindow.on("closed", () => {
    console.log("Notification window closed.");
    notificationWindow = null;
  });
}

let scriptInjected = false;

// 注入 WebSocket 脚本的函数
function injectWebSocketScript() {
  if (reqId && didFinishLoad && !scriptInjected) {
    scriptInjected = true;
    console.log("Injecting WebSocket script with reqId:", reqId);
    mainWindow.webContents
      .executeJavaScript(
        `
  console.log('Injected script is running.');
  const socket = new WebSocket('wss://woa.wps.cn/sub?req_id=${reqId}');
  socket.onopen = () => {
    console.log('WebSocket connection opened.');
  };
  socket.onmessage = (event) => {
    console.log('WebSocket message received:', event.data);
    const data = JSON.parse(event.data);
    if (data && data.type === 'new_message') {
      console.log('Received new message:', data);
      const message = {
        sender: data.sender_name || '未知发送者',
        content: data.message,
      };
      console.log('Sending message via electronAPI:', message);
      window.electronAPI.sendNewMessage(JSON.stringify(message)); // 使用 JSON.stringify
    }
  };
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
`
      )
      .then(() => {
        console.log("Injected script executed successfully.");
      })
      .catch((error) => {
        console.error("Error executing injected script:", error);
      });
  }
}

// 监听新消息的事件
// 监听新消息的事件
ipcMain.on("new-message", async (event, message) => {
  try {
    const msg = JSON.parse(message);
    console.log("Received new-message event with message:", msg);

    // 显示系统通知
    notifier.notify(
      {
        title: "新消息提醒",
        message: msg.content,
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

    // 如果通知窗口不存在，则创建并显示
    if (!notificationWindow) {
      console.log("Notification window does not exist. Creating one.");
      createNotificationWindow();
    } else {
      console.log("Notification window already exists.");
      notificationWindow.show();
      notificationWindow.focus();
    }

    // 发送新消息到通知窗口
    console.log("Sending 'update-message' to notification window.");
    notificationWindow.webContents.send("update-message", message);
  } catch (error) {
    console.error("Error parsing message:", error);
  }
});

// 应用程序准备就绪时
app.on("ready", () => {
  createWindow();
  createNotificationWindow(); // 应用启动时创建通知窗口
});

// 所有窗口关闭时
app.on("window-all-closed", () => {
  // 保持应用程序在所有窗口关闭后仍然运行（除非在 macOS 上）
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 应用程序被激活时（通常用于 macOS）
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
