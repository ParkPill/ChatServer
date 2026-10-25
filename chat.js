#!/usr/bin/env node
var WebSocketServer = require('websocket').server;
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

// 시크릿 키는 CHAT_SECRET env 가 우선, 없으면 git 에 올라가지 않는 secret.key 파일에서 읽는다.
// 키가 없으면 아무나 접속할 수 있게 되므로 아예 시작하지 않는다.
var SECRET_FILE = path.join(__dirname, 'secret.key');
var secretKey = process.env.CHAT_SECRET;
if (!secretKey) {
    try {
        secretKey = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    } catch (e) {
        secretKey = '';
    }
}
if (!secretKey) {
    console.error('No secret key. Create ' + SECRET_FILE + ' (e.g. `openssl rand -hex 32 > secret.key`) or set CHAT_SECRET.');
    process.exit(1);
}
var secretKeyBuffer = Buffer.from(secretKey, 'utf8');

// 전환 기간: 기존 게임들이 아직 키를 안 보내므로 키 없는 접속은 경고만 남기고 받는다(틀린 키는 거절).
// 모든 게임이 키를 보내게 되면 true 로 바꾸고 `pm2 restart chat`.
var REQUIRE_KEY = false;

// 길이가 다르면 바로 false, 같으면 timingSafeEqual 로 비교해 응답 시간으로 키를 추측하지 못하게 한다.
function isValidKey(key) {
    if (typeof key !== 'string') {
        return false;
    }
    var keyBuffer = Buffer.from(key, 'utf8');
    return keyBuffer.length === secretKeyBuffer.length && crypto.timingSafeEqual(keyBuffer, secretKeyBuffer);
}


var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});
// nginx 뒤에 둘 때는 PORT/HOST 로 내부 주소를 지정한다. env 가 없으면 기존 동작 그대로.
var port = process.env.PORT || 8104;
var host = process.env.HOST || '0.0.0.0';
server.listen(port, host, function() {
    console.log((new Date()) + ' Server is listening on ' + host + ':' + port);
});

wsServer = new WebSocketServer({
    httpServer: server,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // put logic here to detect whether the specified origin is allowed.
  return true;
}
// Map 을 쓰는 이유: 일반 배열/객체는 'constructor', '__proto__' 같은 방 이름이 기본 속성과 겹쳐 서버가 죽는다.
var chatRooms = new Map();   // roomName -> [connection]
var chatHistory = new Map(); // roomName -> [message]
var roomLastSeen = new Map(); // roomName -> 마지막으로 누군가 방에 있었던 시각(ms)

// 모두 나가도 기록은 남겨 두고, 30일 동안 아무도 들어오지 않은 방만 지운다.
var ROOM_EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;
var ROOM_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function cleanupRooms() {
    var now = Date.now();
    roomLastSeen.forEach(function(lastSeen, roomName) {
        var peers = chatRooms.get(roomName);
        if (peers !== undefined && peers.length > 0) {
            return; // 누가 있는 방은 지우지 않는다.
        }
        if (now - lastSeen > ROOM_EXPIRE_MS) {
            chatRooms.delete(roomName);
            chatHistory.delete(roomName);
            roomLastSeen.delete(roomName);
            console.log((new Date()) + ' Expired room: ' + roomName);
        }
    });
}
setInterval(cleanupRooms, ROOM_CLEANUP_INTERVAL_MS);
// code
// 0 join or create
// 1 msg
// 2 quit

function broadcast(roomName, data) {
    var peers = chatRooms.get(roomName);
    if (peers === undefined) {
        return;
    }
    peers.forEach(function(peer) {
        if (peer.connected) {
            peer.sendUTF(data);
        }
    });
}

// 방 목록에서 connection 을 빼고, notify 면 남은 사람들에게 퇴장을 알린다.
function leaveRoom(connection, notify) {
    var roomName = connection.roomName;
    if (roomName === undefined || !chatRooms.has(roomName)) {
        return;
    }
    var peers = chatRooms.get(roomName);
    var index = peers.indexOf(connection);
    if (index > -1) {
        peers.splice(index, 1);
    }
    connection.roomName = undefined;
    roomLastSeen.set(roomName, Date.now());
    if (notify) {
        broadcast(roomName, '2' + connection.userName);
    }
    console.log("chatRoom " + roomName + " users left : " + peers.length);
}

function handleMessage(connection, msg) {
    var chatCode = msg.substring(0, 1); // 0-join, 1-msg, 2-quit
    var underBarIndex = msg.indexOf('_');

    if (chatCode == '0') { // join or create
        if (underBarIndex < 1) {
            return; // 형식이 잘못된 메시지는 무시한다.
        }
        var roomName = msg.substring(1, underBarIndex);
        var userName = msg.substring(underBarIndex + 1);

        // 다시 입장하면 이전 방에서 먼저 뺀다. 같은 방이면 조용히, 다른 방이면 퇴장 알림.
        leaveRoom(connection, connection.roomName !== roomName);

        if (!chatRooms.has(roomName)) {
            chatRooms.set(roomName, []);
        }
        if (!chatHistory.has(roomName)) {
            chatHistory.set(roomName, []);
            console.log("chat history create: " + roomName);
        }
        connection.roomName = roomName;
        connection.userName = userName;
        roomLastSeen.set(roomName, Date.now());
        chatRooms.get(roomName).push(connection);
        chatHistory.get(roomName).forEach(function(history) {
            connection.sendUTF(history);
        });
        broadcast(roomName, '0' + userName);
    } else if (chatCode == '1') { // msg
        // 방은 메시지에 적힌 이름이 아니라 입장한 방으로 정한다. 입장 전 메시지는 무시.
        if (connection.roomName === undefined || underBarIndex < 0) {
            return;
        }
        var data = '1' + connection.userName + ':' + msg.substring(underBarIndex + 1);
        broadcast(connection.roomName, data);
        var history = chatHistory.get(connection.roomName);
        history.push(data);
        if (history.length > 100) {
            history.shift();
        }
    } else if (chatCode == '2') { // quit
        // 퇴장 알림은 close 핸들러에서 한 번만 보낸다.
        connection.close();
    }
}

wsServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      //console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }
    // 브라우저 WebSocket 은 헤더를 못 붙이므로 키는 접속 URL 의 ?key= 로 받는다.
    var key = request.resourceURL.query.key;
    if (key === undefined && !REQUIRE_KEY) {
      console.warn((new Date()) + ' Connection without key from ' + request.remoteAddress + ' (' + request.httpRequest.headers['user-agent'] + ') allowed during transition');
    } else if (!isValidKey(key)) {
      request.reject(401, 'Invalid key');
      console.log((new Date()) + ' Connection from ' + request.remoteAddress + ' rejected: invalid key');
      return;
    }
    //console.log("request.origin: " + request.origin);
    
    var connection = request.accept('echo-protocol', request.origin);
    //console.log((new Date()) + ' Connection accepted.');
    //console.dir(connection);
    connection.on('message', function(message) {
        if (message.type === 'utf8') {
            console.log('Received Message: ' + message.utf8Data);
            try {
                handleMessage(connection, message.utf8Data);
            } catch (e) {
                // 메시지 하나 때문에 모든 방이 날아가지 않도록 여기서 막는다.
                console.error((new Date()) + ' Failed to handle message: ' + message.utf8Data, e);
            }
        }
        else if (message.type === 'binary') {
            console.log('Received Binary Message of ' + message.binaryData.length + ' bytes');
            connection.sendBytes(message.binaryData);
        }
    });
    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected from ' + connection.roomName);
        leaveRoom(connection, true);
    });
});
