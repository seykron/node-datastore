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

  /** Util to generate UUIDs.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var uuid = require("node-uuid");

  /** Node's UDP API.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var dgram = require("dgram");

  /** Node's Buffer API.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var buffer = require("buffer");

  /** Mapping from peers to active requests.
   * @type {Object}
   * @private
   * @fieldOf NetworkManager#
   */
  var peerRequests = {};

  /** Local UDP socket, never null after initialize().
   * @type {Socket}
   * @private
   * @fieldOf NetworkManager#
   */
  var socket;

  /** List of incoming messages listeners.
   * @type {Function[]}
   * @private
   * @fieldOf NetworkManager#
   */
  var messageListeners = [];

  /** Gateway instance to map ports between peers.
   * @type {Gateway}
   * @private
   * @fieldOf NetworkManager#
   */
  var gateway = new Gateway();

  /** Creates a peer-to-peer request to the specified peer.
   *
   * @param {Peer} source Peer sending the message. Cannot be null.
   * @param {Peer} peer Peer to open request to. Cannot be null.
   * @param {Function} callback Callback to receive peer responses. It takes an
   *    error and the response object as parameter. Cannot be null.
   * @return {Object} Returns a valid request, never returns null.
   * @private
   * @methodOf NetworkManager#
   */
  var createRequest = function (source, peer, callback) {
    var transport = peerRequests[peer.id];
    var requestId = uuid.v4();
    var request = {
      waitResponse: false,
      callback: callback
    };

    if (!transport) {
      transport = {};
      peerRequests[peer.id] = transport;
    }

    transport[requestId] = request;

    return {

      /** Sends the specified message.
       * @param {Object} message Message to send. Cannot be null.
       */
      send: function (message) {
        var str = new Buffer(JSON.stringify({
          source: source.id,
          target: peer.id,
          ping: requestId,
          message: message
        }));
        var timeout = 0;

        LOG.info("Sending message to peer " + peer.id + "[" + peer.address +
          ":" + peer.port + "]");

        // TODO (seykron): it assumes the peer has an open port in the
        // underlying public address, it should take into account clients behind
        // routers and physical subnets.
        socket.send(str, 0, str.length, peer.port, peer.address, function () {
          clearTimeout(timeout);
        });

        timeout = setTimeout(function () {
          timeout = -1;
          callback(new Error("send(): connection timeout: " + peer.address +
            ":" + peer.port));
        }, TIMEOUT);

        if (!request.waitResponse) {
          delete transport[requestId];
          callback(null);
        }
      },

      /** Sets whether the transport will wait for the peer response or not.
       * @param {Boolean} waitResponse Indicates whether to wait or not for
       *    peer response. Cannot be null.
       */
      waitResponse: function (waitResponse) {
        request.waitResponse = waitResponse;
      }
    };
  };

  /** Handles a single peer connection. It waits for messages and sends back
   * responses to the underlying peer.
   *
   * @param {Object} data Peer message data. Cannot be null.
   * @param {Object} peerInfo Object containing peer address information. Cannot
   *    be null.
   * @private
   * @methodOf NetworkManager#
   */
  var handlePeerRequest = function (data, peerInfo) {
    messageListeners.forEach(function (listener) {
      if (data.ping) {
        listener(data.message, function (err, response) {
          var result = new Buffer(JSON.stringify({
            source: data.target,
            pong: data.ping,
            error: err && err.message,
            message: response
          }));
          socket.send(result, 0, result.length, peerInfo.port,
            peerInfo.address);
        });
      }
    });
  };

  /** Handles a response from a peer.
   *
   * @param {Object} data Peer message data. Cannot be null.
   * @param {Object} peerInfo Object containing peer address information. Cannot
   *    be null.
   * @private
   * @methodOf NetworkManager#
   */
  var handlePeerResponse = function (data, peerInfo) {
    var transport = peerRequests[data.source];
    var request = transport[data.pong];

    try {
      if (request && request.waitResponse) {
        request.callback(data.error, data.message);
      }
    } finally {
      delete transport[data.pong];
    }
  };

  /** Initializes the message server to listen for peer connections.
   * @param {Peer} peer Peer where server will listen for messages. Cannot be
   *    null.
   * @param {Function} callback Callback invoked when the message server is up
   *    and running. Cannot be null.
   * @private
   * @methodOf NetworkManager#
   */
  var initMessageServer = function (peer, callback) {
    LOG.info("Initializing message server.");

    socket = dgram.createSocket("udp4", function (msg, rinfo) {
      var data = JSON.parse(msg.toString());

      if (data.ping) {
        LOG.debug("Request [" + data.ping + "] received from " +
          rinfo.address + ":" + rinfo.port);
        handlePeerRequest(data, rinfo);
      } else if (data.pong) {
        LOG.debug("Response [" + data.pong + "] received from " +
          rinfo.address + ":" + rinfo.port);
        handlePeerResponse(data, rinfo);
      } else {
        throw new Error("Message not recognized: " + msg);
      }
    });
    socket.on("error", function (err) {
      LOG.info("Message server error: " + err);
      socket.close();
      throw err;
    });
    socket.bind(peer.port, callback);
  };

  return {

    /** Initializes the network manager.
     * @param {Function} callback Callback invoked once the network manager
     *    is initialized. Cannot be null.
     */
    initialize: function (callback) {
      LOG.debug("Initializing uPnP gateway.");
      gateway.ready(callback);
    },

    /** Listens for messages in the specified node. The network manager must
     * have access to listen in the node's port and address.
     *
     * @param {Peer} peer Peer to listen for messages. Cannot be null.
     * @param {Function} [callback] Callback invoked when the network manager is
     *   already initialized. It takes an error as parameter. Can be null.
     */
    listen: function (peer, callback) {
      LOG.info("Acquiring port to listen on " + peer.address +
        ":" + peer.port);

      // Maps local port.
      gateway.openPort("udp", peer.port, function (err) {
        if (err) {
          LOG.info("Gateway couldn't acquire required port.");
          callback(err);
        } else {
          initMessageServer(peer, callback);
        }
      });
    },

    /** Adds an incoming message listener. It will only notify messages.
     *
     * @param {Function} listener Callback invoked when a message arrives. It
     *    takes the incoming message and a callback that must be invoked with
     *    an error and the response to send it back to client.
     */
    addMessageListener: function (listener) {
      LOG.debug("New message listener found.");

      messageListeners.push(listener);
    },

    /** Broadcast a message to specified nodes in the peer network and waits
     * for responses.
     *
     * @param {Peer} theSource Peer that sends the broadcast. Cannot be null.
     * @param {Peer[]|Object} thePeers List or network map of peers to broadcast
     *    the message to. Cannot be null.
     * @param {Object} message Message to send. Cannot be null.
     * @param {Function} [callback] Callback notified when a response arrives
     *    from a single node. It takes an error, the node and the response as
     *    as parameters. Can be null if no response notification is required.
     */
    broadcast: function (theSource, thePeers, message, callback) {
      var peerList = [];
      var nodeId;

      if (Array.isArray(thePeers)) {
        peerList = thePeers;
      } else {
        for (nodeId in thePeers) {
          if (thePeers.hasOwnProperty(nodeId)) {
            peerList.push(thePeers[nodeId]);
          }
        }
      }

      LOG.info("Broadcasting message to " + peerList.length + " peers: " +
        JSON.stringify(message));

      peerList.forEach(function (node) {
        var request = createRequest(theSource, node, function (err, response) {
          if (callback) {
            callback(err, node, response);
          }
        });
        request.waitResponse(callback !== undefined);
        request.send(message);
      });
    },

    /** Retrieves the network's public IP address.
     * @param {Function} callback Callback notified when the external IP address
     *    is available. It takes an error and the ip address as parameters.
     *    Cannot be null.
     */
    getExternalAddress: gateway.getExternalAddress
  };
};
