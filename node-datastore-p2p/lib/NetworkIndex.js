/** Index to manage a P2P distributed index over internet.
 *
 * Additionally to content index, it provides access to the peer network map.
 * The network map consist of a set of peers related to another peers by a trust
 * relationship. The index provides the list of trusted peers for the local
 * machine.
 *
 * When an item doesn't exist in the local index, it sends a broadcast to the
 * peer network and waits for peer indexes resolution. The first response is
 * assumed as the required entry and it's saved into the local index in order to
 * perform a local lookup the next time. If no peer answer is received during a
 * period of time it raises an item not found error.
 *
 * @param {String} baseDir Base directory to index file. Cannot be null or
 *    empty.
 * @param {NetworkManager} networkManager Network manager used to communicate
 *    with other indexes in the peer network. Must be initialized. Cannot be
 *    null.
 * @constructor
 * @augments FileSystemIndex
 */
module.exports = function NetworkIndex (baseDir, networkManager) {

  /** Default logger.
   * @constant
   * @private
   * @fieldOf NetworkIndex#
   */
  var LOG = require("winston");

  /** Name of the peer network map entry in the index.
   * @constant
   * @private
   * @fieldOf NetworkIndex#
   */
  var PEER_NETWORK_ENTRY = "__p2p__";

  /** Entry that represents the local machine's node.
   * @constant
   * @private
   * @fieldOf NetworkIndex#
   */
  var LOCAL_NODE_ENTRY = "__local__";

  /** Util to extend objects.
   * @type {Function}
   * @private
   * @fieldOf NetworkIndex#
   */
  var extend = require("extend");

  /** Base constructor to inherit behaviour.
   * @type {Function}
   * @private
   * @fieldOf NetworkIndex#
   */
  var FileSystemIndex = require("../../node-datastore-fs/lib/FileSystemIndex");

  /** Point-to-point peer constructor.
   * @type {Function}
   * @private
   * @fieldOf NetworkIndex#
   */
  var Peer = require("./Peer");

  /** Base index to inherit behaviour.
   * @type {Object}
   * @private
   * @fieldOf NetworkIndex#
   */
  var base = new FileSystemIndex(baseDir);

  /** Base getItem() method.
   * @type {Function}
   * @private
   * @fieldOf NetworkIndex#
   */
  var getItem = base.getItem;

  /** Base createItem() method.
   * @type {Function}
   * @private
   * @fieldOf NetworkIndex#
   */
  var createItem = base.createItem;

  /** Peer that represents the local machine. It's never null after
   * initialize().
   * @type {Peer}
   * @private
   * @fieldOf NetworkIndex#
   */
  var localNode;

  /** Messages supported by the index.
   *
   * @namespace
   * @private
   * @fieldOf NetworkIndex#
   */
  var Messages = {
    "index:getItem": function (message, callback) {
      base.getItem(message.id, function (err, item) {
        callback(err, {
          id: item.getId(),
          metadata: item.getMetadata()
        });
      });
    },
    "index:createItem": function (message, callback) {
      createItem(message.id, message.metadata, function (err, item) {
        callback(err, item);
      });
    }
  };

  /** Retrieves the network map from the index.
   * @param {Function} callback Callback invoked to provide the network map
   *    entry. It takes an error and the network root node as parameters. Cannot
   *    be null.
   */
  var getRootNetworkEntry = function (callback) {
    getItem(PEER_NETWORK_ENTRY, function (err, root) {
      callback(err, root && root.getMetadata());
    });
  };

  /** Returns the list of nodes related to the current node by a trust
   * relationship.
   *
   * @param {Function} callback Callback to notify when required nodes are
   *    available. It takes an error and map from node id to node object
   *    as parameters. Cannot be null.
   * @private
   * @methodOf NetworkIndex#
   */
  var getPeers = function (callback) {
    getRootNetworkEntry(function (err, root) {
      var nodeId;
      var nodesMap = {};

      if (err) {
        return callback(err, null);
      }

      for (nodeId in root) {
        if (nodeId !== LOCAL_NODE_ENTRY && root.hasOwnProperty(nodeId)) {
          nodesMap[nodeId] = new Peer(root[nodeId]);
        }
      }

      callback(null, nodesMap);
    });
  };

  /** Broadcasts a message to the whole peer network.
   *
   * @param {Object} message Message to broadcast. Cannot be null.
   * @param {Function} [callback] Callback to notify when the message is sent to
   *    to whole peer network, if any. It takes an error as parameter.
   * @private
   * @methodOf NetworkIndex#
   */
  var broadcast = function (message, callback) {
    getPeers(function (err, nodes) {
      networkManager.broadcast(localNode, nodes, message);
      if (callback) {
        callback();
      }
    });
  };

  /** Broadcasts a message to the whole peer network and returns the first
   * non-error response. It ignores responses with error and it raises an error
   * on timeout.
   * @param {Object} message Message to broadcast. Cannot be null.
   * @param {Function} callback Callback to notify the response, if any. It
   *    takes an error, the node that answered and the required item as
   *    parameters.
   * @private
   * @methodOf NetworkIndex#
   */
  var broadcastAndWait = function (message, callback) {
    getPeers(function (err, nodes) {
      var done = false;

      // TODO (seykron): implement timeout and hops limit.
      networkManager.broadcast(localNode, nodes, message,
        function (err, node, response) {
          if (!done && !err) {
            done = true;
            callback(null, node, response);
          }
        });
    });
  };

  /** Initializes network message listener for this index.
   * @private
   * @methodOf NetworkIndex#
   */
  var initMessageListener = function () {
    networkManager.addMessageListener(function (message, callback) {
      var handler;

      if (Messages.hasOwnProperty(message.type)) {
        LOG.info("Message " + message.type + " received.");
        handler = Messages[message.type];
        handler(message, callback);
      } else {
        LOG.info("Message " + message.type + " not found.");
        callback(new Error("Message " + message.type
          + " cannot be handled by this index."), null);
      }
    });
  };

  /** Initializes the peer that represents the local machine.
   *
   * @param {DataStoreItem} root Network map root entry. Can be null.
   * @param {Function} callback Callback invoked when the local peer is
   *    ready. It takes an error and the Peer as parameters. Cannot be null.
   */
  var initLocalPeer = function (root, callback) {
    if (root) {
      callback(null, new Peer(root[LOCAL_NODE_ENTRY]));
    } else {
      // Network map doesn't exist, searches for the local node ip address.
      networkManager.getExternalAddress(function (err, address) {
        if (err) {
          callback(err);
        } else {
          localNode = new Peer({
            address: address
          });
          callback(err, localNode);
        }
      });
    }
  };

  /** Initializes peer networok registry.
   * @param {Function} callback Callback invoked when the network entry has been
   *    initialized. It takes an error as parameter. Cannot be null.
   * @private
   * @methodOf NetworkIndex#
   */
  var initNetwork = function (callback) {
    LOG.info("Initializing peer network map.");

    // Creates network entry if it doesn't exist.
    getRootNetworkEntry(function (rootEntryErr, item) {
      LOG.info("Waiting for local machine peer to initialize.");

      initLocalPeer(item, function (peerErr, peer) {
        var root = {};

        if (peerErr) {
          LOG.info("Error initializing local machine peer: " + peerErr);
          callback(peerErr);
          return;
        }
        if (rootEntryErr) {
          LOG.info("Network map doesn't exist, creating it.");

          // Root entry doesn't exist, let's create it.
          root[LOCAL_NODE_ENTRY] = peer;
          createItem(PEER_NETWORK_ENTRY, root, function (err) {
            if (err) {
              LOG.info("Error creating network map: " + err);

              callback(err);
            } else {
              LOG.info("Network map ready. Listening for messages on " +
                peer.address + ":" + peer.port);

              networkManager.listen(peer, callback);
            }
          });
        } else {
          // Root entry exist, network map is ready. Initializes network
          // manager.
          LOG.info("Network map already exist. Listening for messages on " +
            peer.address + ":" + peer.port);
          networkManager.listen(peer, callback);
        }
      });
    });
  };

  return extend(base, {

    /** Initializes the index and synchronizes the index if required.
     * @param {Function} callback Callback notified when the index is already
     *    initialized. It takes an error as parameter. Cannot be null.
     */
    initialize: function (callback) {
      initNetwork(function (err) {
        if (err) {
          callback(err);
        } else {
          initMessageListener();
          callback(null);
        }
      });
    },

    /** Retrieves a single item from the index.
     *
     * @param {String} id Required item id. Cannot be null or empty.
     * @param {Function} callback Callback that receives the required item. It
     *    takes an error and the item as parameters. Cannot be null.
     */
    getItem: function (id, callback) {
      getItem(id, function (err, item) {
        if (item) {
          callback(err, item);
        } else {
          // Item not found in the local index, broadcasting to the peer
          // network.
          broadcastAndWait({
            type: "index:getItem",
            id: id
          }, function (err, node, remoteItem) {
            if (err) {
              callback(err, null);
            } else {
              // Creates unexisting item in the local index.
              base.createItem(remoteItem.id, extend(remoteItem.metadata, {
                nodes: [node.id]
              }), callback);
            }
          });
        }
      });
    },

    /** Creates a new item and saves it to the index.
     *
     * @param {String} id Unique id for the item. Cannot be null or empty.
     * @param {Object} metadata Item metadata, it's used to initialize the new
     *    item. Metadata cannot be modified once item is created. Can be null.
     * @param {Function} callback Callback that receives the new item. It
     *    takes an error and the item as parameters. Cannot be null.
     */
    createItem: function (id, metadata, callback) {
      createItem(id, metadata, function (error, item) {
        broadcast({
          type: "index:createItem",
          id: item.getId(),
          metadata: item.getMetadata()
        });
        callback(error, item);
      });
    },

    /** Adds the specified node to the peer network map. If the peer already
     * exists it updates the existing instance.
     *
     * @param {Peer} peer Peer joining the network. Cannot be null.
     * @param {Function} callback Callback to notify when the peer is added
     *    to the peer network. It takes an error as parameter. Cannot be null.
     */
    join: function (peer, callback) {
      getRootNetworkEntry(function (err, root) {
        if (err) {
          callback(err);
        } else {
          root[peer.id] = peer;
          callback(null);
        }
      });
    },

    /** Removes the specified node from the peer network. Data related to the
     * peer will not be removed from the index.
     *
     * @param {Peer} peer Peer to remove. Cannot be null.
     * @param {Function} callback Callback to notify when the peer is removed
     *    from the peer network. It takes an error as parameter. Cannot be null.
     */
    leave: function (peer, callback) {
      getRootNetworkEntry(function (err, root) {
        if (err) {
          callback(err);
        } else {
          delete root[peer.id];
          callback(null);
        }
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
    },

    /** Returns the list of peers within the current node trust network.
     *
     * @param {Function} callback Callback to notify when required peers are
     *    available. It takes an error and map from node id to node object
     *    as parameters. Cannot be null.
     */
    getPeers: function (callback) {
      getPeers(callback);
    }
  });
};
