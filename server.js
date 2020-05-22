#!/usr/bin/env node
var WebSocketServer = require('websocket').server;
var http = require('http');
var chatRooms = [];

var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});
server.listen(8104, function() {
    console.log((new Date()) + ' Server is listening on port 8104');
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
var chatRooms = [];
// code
// 0 join or create
// 1 msg
// 2 quit
wsServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      //console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }
    //console.log("request.origin: " + request.origin);
    
    var connection = request.accept('echo-protocol', request.origin);
    //console.log((new Date()) + ' Connection accepted.');
    //console.dir(connection);
    connection.on('message', function(message) {
        if (message.type === 'utf8') {
            
            var msg = message.utf8Data;
            console.log('Received Message: ' + msg);
            var msgBroadcast = '';
            var underBarIndex = msg.indexOf('_');
            console.log("underbar index: " + underBarIndex);
            var roomName = msg.substring(1, underBarIndex);
            console.log("room name: " + roomName);
            var chatCode = 0; // 0-join, 1-msg, 2-quit
            var msgContent = msg.substr(underBarIndex+1, msg.length - underBarIndex - 1);
            if(msg.substring(0, 1) == '0'){ // join or create
                if(chatRooms[roomName] === undefined){
                    chatRooms[roomName] = [];
                    console.log("create room: " + roomName);
                }
                connection.roomName = roomName;
                
                connection.userName = msgContent;
                chatRooms[roomName].push(connection);
                chatCode = '0';
                console.log(connection.userName + " join");
                console.log("total user count in room " + roomName + ": " + chatRooms[roomName].length);
            }else if(msg.substring(0, 1) == '1'){ // msg
                chatCode = '1';
                //console.log(connection.userName + " msg:" + msgContent);
                msgContent = connection.userName + ':' + msgContent;
            }else if(msg.substring(0, 1) == '2'){ // quit
                chatCode = '2';
                //console.log(connection.userName + " quit");
                connection.close();
            }
            console.log("connection.roomName: " + connection.roomName);
            chatRooms[roomName].forEach(myFunction);
            console.log("peers: " + chatRooms[roomName].length);

            function myFunction(peer) {
                console.log("send message to peer: " + peer.userName);
                peer.sendUTF(chatCode + msgContent);
            }
        }
        else if (message.type === 'binary') {
            console.log('Received Binary Message of ' + message.binaryData.length + ' bytes');
            connection.sendBytes(message.binaryData);
        }
    });
    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected from ' + connection.roomName);
        chatRooms[connection.roomName].forEach(myFunction);
        function myFunction(peer) {
            peer.sendUTF('2' + connection.userName);
        }
        
//        if(chatRooms.indexOf(connection.roomName) >= 0){
            const index = chatRooms[connection.roomName].indexOf(connection);
            console.log("peer index in chatRoom " + index);
            console.log("chatRoom " + connection.roomName + " users left : " + chatRooms[connection.roomName].length);
            
            if (index > -1) {
                chatRooms[connection.roomName].splice(index, 1);
            }
//        }
        
        console.log("disconnected total user count in room " + connection.roomName + "/ left count: " + chatRooms[connection.roomName].length);
        
    });
});