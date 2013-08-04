/** Manages peer network connections.
 *
 * @constructor
 */
module.exports = function NetworkManager (namespace) {

  /** General-purpose timeout.
   * @constant
   * @private
   * @fieldOf NetworkManager#
   */
  var TIMEOUT = 6000;

  /** Default logger.
   * @constant
   * @private
   * @fieldOf NetworkManager#
   */
  var LOG = require("winston");

  /** Gateway to map ports between peers.
   * @type {Function}
   * @private
   * @fieldOf NetworkManager#
   */
  var Gateway = require("./Gateway");

  /** Point-to-point peer constructor.
   * @type {Function}
   * @private
   * @fieldOf NetworkIndex#
   */
  var Peer = require("./Peer");

  /** Util to generate UUIDs.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var uuid = require("node-uuid");

  /** Node's events API.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var events = require('events');

  /** Node's UDP API.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var dgram = require("dgram");

  /** Node's HTTP API.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var http = require("http");

  /** Util to extend objects.
   * @type Function
   * @private
   * @fieldOf NetworkDevice#
   */
  var extend = require("extend");

  /** Node's Buffer API.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var Buffer = require("buffer").Buffer;

  /** Mapping from peers to active requests.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var peerRequests = {};

  /** Mapping from namespace to message listener calbacks.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var messageListeners = {};

  /** Local UDP socket, never null after initialize().
   * @type {Socket}
   * @private
   * @fieldOf NetworkManager#
   */
  var socket;

  /** Gateway instance to map ports between peers.
   * @type {Gateway}
   * @private
   * @fieldOf NetworkManager#
   */
  var gateway = new Gateway();

  /** Peer that represents the local machine. It's never null after
   * initialize().
   * @type {Peer}
   * @private
   * @fieldOf NetworkIndex#
   */
  var localNode;

  /** Sends a message to a peer.
   * @param {Peer} target Peer to send message to. Cannot be null.
   * @param {Object} message Message to send. Cannot be null.
   * @param {Function} callback Callback invoked to notify if there's a network
   *    error the message result. It takes an error. Cannot be null.
   * @private
   * @methodOf NetworkManager#
   */
  var send = function (target, message, callback) {
    var str = new Buffer(JSON.stringify(message));
    var timeout = 0;

    // TODO (seykron): it assumes the peer has an open port in the
    // underlying public address, it should take into account clients behind
    // routers and physical subnets.
    socket.send(str, 0, str.length, target.port, target.address, function () {
      clearTimeout(timeout);
    });

    timeout = setTimeout(function () {
      timeout = -1;
      callback(new Error("send(): connection timeout: " + target.address +
        ":" + target.port));
    }, TIMEOUT);
  };

  /** Handles a single peer connection. It waits for messages and sends back
   * responses to the underlying peer.
   *
   * @param {Object} message Peer message data. Cannot be null.
   * @param {Object} peerInfo Object containing peer address information. Cannot
   *    be null.
   * @private
   * @methodOf NetworkManager#
   */
  var handlePeerRequest = function (request, peerInfo) {
    var handlersStack = messageListeners[request.namespace];

    handlersStack.forEach(function (handlers) {
      var listener = handlers && handlers[request.type];
      var response = extend({}, request, {
        source: request.target,
        target: request.source,
        ping: false,
        pong: true
      });
      var target = extend(peerInfo, {
        id: request.source
      });

      if (listener) {
        listener(request, function (err, data) {
          response.error = err;
          response.data = data;

          send(target, extend(response, {
            error: err,
            data: data
          }));
        });
      } else {
        send(target, extend(response, {
          error: new Error("Message " + request.type + " not found.")
        }));
      }
    });
  };

  /** Handles a response from a peer.
   *
   * @param {Object} message Peer message data. Cannot be null.
   * @private
   * @methodOf NetworkManager#
   */
  var handlePeerResponse = function (response) {
    var transport = peerRequests[response.source];
    var message = transport && transport[response.id];

    if (transport && response.broadcast) {
      delete transport[response.source];
    }

    if (message) {
      if (response.error) {
        message.emit("error", response.error, transport.peer);
      } else {
        message.emit("response", transport.peer, response.data);
      }
    }
  };

  /** Returns a random port number. It doesn't check whether the port is being
   * used or not.
   * @return {Number} Returns a valid port number above 1024, never returns
   *    null.
   * @private
   * @methodOf NetworkManager#
   */
  var randomPort = function () {
    return Math.floor(Math.random() * 12000 + 1024);
  };

  /** Creates the message server listening on the local node.
   * @param {Function} callback Callback invoked when the message server is up
   *    and running. It takes an error as parameter. Cannot be null.
   */
  var createMessageServer = function (callback) {
    LOG.debug("Creating message server.");

    socket = dgram.createSocket("udp4", function (msg, rinfo) {
      var data = JSON.parse(msg.toString());

      // It only handles messages sent to this server.
      if (data.target === localNode.id) {
        if (data.ping) {
          LOG.debug("Request received from " + rinfo.address + ":" +
            rinfo.port);
          handlePeerRequest(data, rinfo);
        } else if (data.pong) {
          LOG.debug("Response received from " + rinfo.address + ":" +
            rinfo.port);
          handlePeerResponse(data);
        } else {
          throw new Error("Message not recognized: " + msg);
        }
      }
    });
    socket.on("error", function (err) {
      LOG.info("Message server error: " + err);
      socket.close();
      callback(err);
    });
    socket.bind(localNode.port, callback);
  };

  /** Initializes the message server to listen for peer connections on
   * localhost.
   *
   * @param {String} namespace A namespace to scope requests. Cannot be
   *    null or empty.
   * @param {Function} listener Calback invoked to handle network messages.
   *    It takes the request and response object as parameters. Cannot be null.
   * @param {Function} callback Callback invoked when the message server is up
   *    and running. It takes an error as parameter. Cannot be null.
   * @private
   * @methodOf NetworkManager#
   */
  var initMessageServer = function (callback) {
    LOG.debug("Acquiring port to listen on " + localNode.address +
      ":" + localNode.port);

    gateway.openPort("udp", localNode.port, function (err) {
      if (err) {
        LOG.info("Gateway couldn't acquire required port.");
        callback(err);
      } else {
        createMessageServer(callback);
      }
    });
  };

  /** Initializes the peer that represents the local machine.
   *
   * @param {DataStoreItem} root Network map root entry. Can be null.
   * @param {Function} callback Callback invoked when the local peer is
   *    ready. It takes an error and the Peer as parameters. Cannot be null.
   * @private
   * @methodOf NetworkManager#
   */
  var initLocalPeer = function (callback) {
    gateway.getExternalAddress(function (err, address) {
      if (err) {
        callback(err);
      } else {
        localNode = new Peer({
          address: address,
          port: randomPort()
        });
        callback(err, localNode);
      }
    });
  };

  return {

    /** Initializes the network manager. It tries to open a uPnP gateway and
     * then it creates the local node initialized with the external address
     * provided by the gateway.
     *
     * @param {Function} callback Callback invoked once the network manager
     *    is initialized. It takes an error and the local node as parameters.
     *    Cannot be null.
     */
    initialize: function (callback) {
      LOG.debug("Initializing uPnP gateway.");

      gateway.ready(function (err) {
        if (err) {
          callback(err);
        } else {
          initLocalPeer(function (err, peer) {
            if (err) {
              callback(err);
              return;
            }
            initMessageServer(function (serverErr) {
              callback(serverErr, peer);
            });
          });
        }
      });
    },

    /** Maps a set of handlers for incoming messages. The handlers object's keys
     * must match the message type, if it doesn't, a NOT FOUND message will be
     * sent back to client.
     *
     * @param {String} namespace A namespace to scope requests. Cannot be
     *    null or empty.
     * @param {Object} handlers Object containing message type as keys, and
     *    handlers functions that receives the request and the response
     *    callback as parameters.
     */
    addMessageHandlers: function (namespace, handlers) {
      var handlersStack = messageListeners[namespace] || [];
      LOG.debug("Registering message handlers for namespace: " + namespace);
      handlersStack.push(handlers);
      messageListeners[namespace] = handlersStack;
    },

    /** Creates and prepares a message to send it to another peers. Message
     * is an event emitter and it will trigger a 'response' event when a single
     * peer response arrives. The 'response' event takes an error, the peer and
     * the raw response as parameters.
     *
     * @param {String} namespace Namespace that's sending the message. Cannot be
     *    null or empty.
     * @param {Peer} targets Peers receiving the message. Cannot be null.
     * @param {String} type Message type. Must be unique in the namespace.
     *    Cannot be null or empty.
     * @param {Object} data Message raw data. Can be null.
     * @param {Object} [options] Message specific options. Can be null.
     * @param {Boolean} [options.broadcast] Indicates whether the message is a
     *    broadcast. Default is false.
     * @param {Boolean} [options.error] Error object. If this field is present,
     *    the message must be considered an error. Can be null.
     * @return {EventEmitter} Returns the message object ready to be sent, never
     *    returns null.
     */
    createMessage: function (namespace, targets, type, data, options) {
      var message = {
        targets: [].concat(targets),
        request: {
          id: uuid.v4(),
          namespace: namespace,
          source: localNode.id,
          error: options && options.error,
          broadcast: options && options.broadcast,
          ping: true,
          type: type,
          data: data
        }
      };
      return extend(new events.EventEmitter(), message);
    },

    /** Sends a message and notifies responses.
     * @param {Object} message Message to send. Must be created with
     *    createMessage(). Cannot be null.
     */
    send: function (message) {
      message.targets.forEach(function (target) {
        var request = extend({}, message.request, {
          target: target.id
        });
        var transport = extend(peerRequests[target.id] || {}, {
          peer: target
        });
        if (message.request.broadcast) {
          transport[request.id] = message;
          peerRequests[target.id] = transport;
        }

        send(target, request, function (err) {
          message.emit("error", err);
        });
      });
    },

    /** Creates an HTTP server and tries to open the specified port if possible.
     *
     * @param {Function} requestListener Callback to handle requests as it's
     *    specified in Node's HTTP documentation. Cannot be null.
     * @param {Function} callback Callback invoked when the server is ready.
     *    It takes an error and the server port as parameters. Cannot be null.
     */
    createHttpServer: function (requestListener, callback) {
      var port = randomPort();

      gateway.openPort("tcp", port, function (err) {
        var server = http.createServer(requestListener);

        if (err) {
          LOG.error("Cannot open port " + port + " to bind HTTP server.");
        } else {
          LOG.debug("Port " + port + " opened to bind HTTP server.");
        }

        server.on("error", function (err) {
          callback(err, port);
        });

        server.listen(port);
        callback(null, port);
      });
    },

    /** Returns the current node (the one representing the local machine) from
     * the index.
     *
     * @return {Peer} Returns the peer that represents the local machine. It
     *    never returns null after initialize();
     */
    getLocalNode: function () {
      return localNode;
    }
  };
};
