'use strict'

var express = require('express');
var request = require('request');
var moment  = require('moment');
var modbus  = require("modbus-stream");
var net     = require('net');
var yaml    = require('js-yaml');
var mysql   = require('mysql');
var mqtt    = require('mqtt');
var fs      = require('fs');
var path    = require('path');
var argv    = require('minimist')(process.argv.slice(2));
//var file    = (argv['f'] == undefined)? '/opt/radix/bin/kaa-connect-simul.yaml' : argv['f'];
var file    = (argv['f'] == undefined)? './kaa-connect-simul.yaml' : argv['f'];
var dict    = yaml.safeLoad(fs.readFileSync(file, 'utf8'));

function getRandomInt(min, max) { 
    return Math.floor(Math.random() * (max - min)) + min;
}

const timeout = 5000
const device  = 12345

function getTemperature () {
  return getRandomInt(18,20);
}

function getHumidity () {
  return getRandomInt(40,60);
}

function getJson () {
  return {"device": device, "temp":getRandomInt(18,20), "humi": getRandomInt(40,60)};
}

function getText () {
  return device + "$" + getRandomInt(18,20) + "$" + getRandomInt(40,60);
}

function cbHttpRequest(element) {
  //console.log(moment().unix());
  var json    = getJson();
  var text    = getText();
  if(dict[element]["body"] == "json") {
    console.log("http|req : " + json)
    request.post("http://" + dict[element]["host"] + ":" + dict[element]["port"] + dict[element]["base"], {
      json: json
    }, (error, res, body) => {
      if (error) {
        console.error(error)
        return
      }
      //console.log(`statusCode: ${res.statusCode}`)
      console.log("http|resp: " + body)
    })
  }
  else {
    console.log("http|req : " + text)
    request.post("http://" + dict[element]["host"] + ":" + dict[element]["port"] + dict[element]["base"], {
      headers: {'content-type' : 'text/plain'},
      body: text
    }, (error, res, body) => {
      if (error) {
        console.error(error)
        return
      }
      //console.log(`statusCode: ${res.statusCode}`)
      console.log("http|resp: " + body)
    })
  }

  setTimeout(cbHttpRequest, timeout, element);
}

function cbMqttPublish (element) {
  //console.log(moment().unix());
  var pub = mqtt.connect("mqtt://" + dict[element]["host"] + ":" + dict[element]["port"] )
  var json    = getJson();
  var text    = getText();
  if(dict[element]["body"] == "json") {
    console.log("mqtt|pub : " + json)
    pub.publish(dict[element]["topic"], json)
  }
  else {
    console.log("mqtt|pub : " + text)
    pub.publish(dict[element]["topic"], text)
  }

  setTimeout(cbMqttPublish, timeout, element);
}

function cbTcpRequest (element) {
  var host = dict[element]["host"]
  var port = dict[element]["port"]
  var client = require('net').connect({host: host, port: port});

  var message = (dict[element]["body"] == "json")? getJson(): getText();
  client.write(message);
  client.end();

/*
  client.on('data', function (data) {
    console.log("tcp |resp: " + data)
    client.end();
  });
*/

  setTimeout(cbTcpRequest, timeout, element);
}

function cbUdpRequest (element) {
  var host = dict[element]["host"]
  var port = dict[element]["port"]
  var client = require('dgram').createSocket('udp4');

  var message = (dict[element]["body"] == "json")? getJson(): getText();
  client.send(message, 0, message.length, port, host, null);

  setTimeout(cbUdpRequest, timeout, element);
}

function cbModbusRequest (element) {
  console.log("cbModbusRequest");
  var host = dict[element]["host"]
  var port = dict[element]["port"];
  var data = dict[element]["data"]
  var offs = dict[element]["offs"]
  var blck = dict[element]["blck"]

  console.log(data);
  var client = require("modbus-stream").tcp.connect(port, host, {}, (err, connection) => {
    if (data == "read-coils") {
      console.log("mbus|req : readCoils");
      connection.readCoils ({address: offs, quantity: blck}, (err, res) => {
        if(err) console.log (err);
        else    console.log (res.response);
      });
    }
    if (data == "read-discrete-inputs") {
      console.log("mbus|req : readDiscreteInputs");
      connection.readDiscreteInputs ({address: offs, quantity: blck}, (err, res) => {
        if(err) console.log (err);
        else    console.log (res.response);
      });
    }
    if (data == "read-input-registers") {
      console.log("mbus|req : readInputRegisters");
      connection.readInputRegisters ({address: offs, quantity: blck}, (err, res) => {
        if(err) console.log (err);
        else    console.log (res.response);
      });
    }
    if (data == "read-holding-registers") {
      console.log("mbus|req : readHoldingRegisters");
      connection.readHoldingRegisters ({address: offs, quantity: blck}, (err, res) => {
        if(err) console.log (err);
        else    console.log (res.response);
      });
    }
  });

  setTimeout(cbModbusRequest, timeout, element);
}

function getModbusPdu (pdu) {
  var code = pdu.readUInt8(0);
  var address = pdu.readUInt16BE(1);
  var quantity = pdu.readUInt16BE(3);
  return { 'code': code, 'address': address, 'quantity': quantity };
}

function setModbusBuf () {
  var buf = Buffer.alloc (4 * 3);

  for (var i = 0; i < 3; i++) {
    if (i == 0) buf.writeUInt32BE(device, 4 * i);
    if (i == 1) buf.writeUInt32BE(getTemperature(), 4 * i);
    if (i == 2) buf.writeUInt32BE(getHumidity(), 4 * i);
  }
  return buf;
}

var http    = express();

dict['services'].forEach(element => {
  if(dict[element]["type"] == "HTTP-SERVER") {
    var server = require('http').createServer(http);
    var port   = process.env.PORT || dict[element]["port"];
    server.listen(port, () => { console.log('http server listening at port %d', port); });

    http.use(express.text());
    http.use(express.urlencoded());
    http.use(express.static(path.join(__dirname, 'public')));

    http.set('views', __dirname + '/views');
    http.set('view engine', 'ejs');
    http.engine('html', require('ejs').renderFile);

    http.get(dict[element]["base"], function(req, res){
      var json    = getJson();
      var text    = getText();
      if(dict[element]["body"] == "json") res.send(json);
      else                                res.send(text);
    })
    http.post("/", function(req, res){
      console.log("http|post: " + req.body)
      res.send(req.body);
    })

  }
  else if(dict[element]["type"] == "HTTP-CLIENT") {
    cbHttpRequest (element);
  }
  else if(dict[element]["type"] == "MQTT-PUBLISHER") {
    cbMqttPublish (element);
  }
  else if(dict[element]["type"] == "MQTT-SUBSCRIBER") {
    var sub = mqtt.connect("mqtt://" + dict[element]["host"] + ":" + dict[element]["port"] )
    sub.on('connect', function () {
      sub.subscribe('kaa/12', function (err) {
      })
    })
    sub.on('message', function (topic, message) {
      console.log("mqtt|sub : " + message.toString())
    })
  }
  else if(dict[element]["type"] == "TCP-SERVER") {
    var server = require('net').createServer(function(socket) {
      //socket.on('data', function (data) { console.log("tcp |data:" + data); });
      //socket.on('error', function (err) { console.log(err); });
      //socket.on('end', function () { console.log("tcp |logs: disconnected"); });
      var json    = getJson();
      var text    = getText();
      if(dict[element]["body"] == "json") {
        console.log("tcp |data: " + json)
        socket.write(json);
      }
      else {
        console.log("tcp |data: " + text)
         socket.write(text);
      }
      socket.end();
    });
    var port   = process.env.PORT || dict[element]["port"];
    server.listen(port, () => { console.log('tcp server listening at port %d', port); });
  }
  else if(dict[element]["type"] == "TCP-CLIENT") {
    cbTcpRequest (element);
  }
  else if(dict[element]["type"] == "UDP-SERVER") {
    var server = require('dgram').createSocket('udp4');
    var port   = process.env.PORT || dict[element]["port"];

    server.on('message', (msg, remote) => {
      var host = remote.address;
      var port = remote.port;
      var json    = getJson();
      var text    = getText();

      if(dict[element]["body"] == "json") {
        console.log("udp |data: " + json)
        server.send(json, 0, json.length, port, host, null);
      }
      else {
        console.log("udp |data: " + text)
        server.send(text, 0, text.length, port, host, null);
      }
    });
    server.bind(port);
    console.log('udp server bind at port %d', port);
  }
  else if(dict[element]["type"] == "UDP-CLIENT") {
    cbUdpRequest(element);
  }
  else if(dict[element]["type"] == "MODBUS-SERVER") {
    var port   = dict[element]["port"];
    var server = modbus.tcp.server({}, (connection) => {
      console.log('mbus|conn: connected');
      connection.on("read-coils", (request, reply) => {
        console.log("mbus|resp: read-coils");
        reply(null, [ 1, 0, 1, 0, 1, 1, 0, 1 ]);
      });
      connection.on("read-discrete-inputs", (request, reply) => {
        console.log("mbus|resp: read-discrete-inputs");
        console.log(getModbusPdu (request.pdu));

        reply(null, [ 1, 0, 1, 0, 1, 1, 0, 1 ]);
      });
      connection.on("read-holding-registers", (request, reply) => {
        console.log("mbus|resp: read-holding-registers");
        console.log(getModbusPdu (request.pdu));
        reply(null, Buffer.from(setModbusBuf()));
      });
      connection.on("read-input-registers", (request, reply) => {
        console.log("mbus|resp: read-input-registers");
        console.log(getModbusPdu (request.pdu));
        reply(null, Buffer.from(setModbusBuf()));
      });
    }).listen(port, () => {
      console.log('modbus tcp server listening at port %d', port);
    });
  }
  else if(dict[element]["type"] == "MODBUS-CLIENT") {
    cbModbusRequest(element);
  }
});

//var mymqtt = mqtt.connect('mqtt://radix-1.tric.kr')

/*
var db = mysql.createConnection({
  host     : 'localhost',
  user     : 'sqladmin',
  password : 'admin',
  database : 'kaa'
});

db.connect();
db.query("set time_zone='+9:00'", function (err, result) {
  if (err) console.log("[mysql] error - timezone");
});
*/

