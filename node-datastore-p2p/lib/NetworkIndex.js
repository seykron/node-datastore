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

  /** Namespace to communicate over the network with the same device.
   * @constant
   * @private
   * @fieldOf NetworkIndex#
   */
  var NAMESPACE = "p2p:index";

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

  /** Handlers for messages supported by the index.
   *
   * @namespace
   * @private
   * @fieldOf NetworkIndex#
   */
  var MessageHandlers = {
    "index:getItem": function (request, callback) {
      LOG.debug("Received getItem(" + request.data.id +
        ") message from network.");

      getItem(request.data.id, function (err, item) {
        if (err) {
          callback(err);
        } else {
          callback(null, {
            id: item.getId(),
            metadata: item.getMetadata()
          });
        }
      });
    },
    "index:createItem": function (request, callback) {
      var message = request.data;

      LOG.debug("Received createItem(" + message.id +
        ") message from network.");

      createItem(message.id, message.metadata, function (err, item) {
        if (err) {
          callback(err);
        }
      });
    }
  };

  /** Broadcasts a message to the whole peer network and notifies the first
   * incoming result.
   *
   * @param {String} type Message type to broadcast. Cannot be null or empty.
   * @param {Object} data Message to broadcast. Cannot be null.
   * @param {Function} callback Callback to notify the response, if any. It
   *    takes an error, the node that answered and the required item as
   * @private
   * @methodOf NetworkIndex#
   */
  var broadcast = function (type, data, callback) {
    var message = networkManager.createBroadcastMessage(NAMESPACE, type, data);
    var done = false;

    if (callback) {
      message.on("error", callback);
      message.on("response", function (peer, response) {
        if (!done) {
          done = true;
          callback(null, peer, response);
        }
      });
    }

    networkManager.send(message);
  };

  /** Initializes the index.
   * @private
   * @methodOf NetworkIndex#
   */
  var initialize = (function () {
    networkManager.addMessageHandlers(NAMESPACE, MessageHandlers);
  }());

  return extend(base, {

    /** Retrieves a single item from the index and search for the item in the
     * peer network if it doesn't exist in the local machine.
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
          broadcast("index:getItem", {
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
        broadcast("index:createItem", {
          id: item.getId(),
          metadata: item.getMetadata()
        });
        callback(error, item);
      });
    }
  });
};
