/** Device that shares items in a p2p network.
 *
 * When items are required and they don't exist in the local file system, this
 * device searches for a peer that contains the item and downloads it into the
 * local file system.
 *
 * @param {String} baseDir Base directory to read and write the items to. Cannot
 *    be null or empty.
 * @param {NetworkManager} networkManager Network manager to communicate between
 *    peers. Must be initialized. Cannot be null.
 * @param {NetworkIndex} index Index to retrieve peer network information.
 *    It must be initialized. Cannot be null.
 * @constructor
 * @augments FileSystemDevice
 */
module.exports = function NetworkDevice (baseDir, networkManager, index) {

  /** Device unique id.
   * @constant
   * @private
   * @fieldOf NetworkDevice#
   */
  var DEVICE_ID = "P2PDevice";

  /** Default logger.
   * @constant
   * @private
   * @fieldOf NetworkDevice#
   */
  var LOG = require("winston");

  /** Device base constructor.
   * @type Function
   * @private
   * @fieldOf NetworkDevice#
   */
  var FileSystemDevice = require("../../node-datastore-fs/lib/" +
    "FileSystemDevice");

  /** DataStoreItem constructor.
   * @type Function
   * @private
   * @fieldOf NetworkDevice#
   */
  var DataStoreItem = require("../../node-datastore/lib/DataStoreItem");

  /** Node file system API.
   * @type {Object}
   * @private
   * @fieldOf NetworkDevice#
   */
  var fs = require("fs");

  /** Node's HTTP API.
   * @type {Object}
   * @private
   * @fieldOf NetworkDevice#
   */
  var http = require("http");

  /** Util to extend objects.
   * @type Function
   * @private
   * @fieldOf NetworkDevice#
   */
  var extend = require("extend");

  /** Base object to inherit behaviour from.
   * @private
   * @fieldOf NetworkDevice#
   */
  var base = new FileSystemDevice(baseDir);

  /** Base get() method.
   * @private
   * @fieldOf NetworkDevice#
   */
  var get = base.get;

  /** Base exists() method.
   * @private
   * @fieldOf NetworkDevice#
   */
  var exists = base.exists;

  /** Port where HTTP server is listening for download requests.
   * @type {Number}
   * @private
   * @fieldOf NetworkDevice#
   */
  var serverPort;

  /** Handlers for messages supported by this device.
   * @namespace
   * @private
   * @fieldOf NetworkDevice#
   */
  var MessageHandlers = {
    "nd:get": function (request, callback) {
      var rawItem = request.data;
      var item = new DataStoreItem(rawItem.id, rawItem.metadata, rawItem.status);

      get(item, function (err, item) {
        if (err) {
          callback(err);
        } else {
          callback(null, {
            port: serverPort
          });
        }
      });
    }
  };

  /** Searches for the specified item over the peer network and waits until a
   * peer answers the request.
   * @param {DataStoreItem} item Required item. Cannot be null.
   * @param {Function} callback Callback invoked when the item request is
   *    answered by a peer, or when the configured timeout is reached. It takes
   *    an error, the Peer that has the item and the remote item descriptor as
   *    parameters. Cannot be null.
   * @private
   * @methodOf NetworkDevice#
   */
  var findItemAndWait = function (item, callback) {
    index.getPeers(function (err, nodes) {
      var message = networkManager.createMessage(DEVICE_ID, nodes, "nd:get", {
        id: item.getId(),
        metadata: item.getMetadata(),
        status: item.status(base)
      }, {
        broadcast: true
      });
      var done = false;

      message.on("error", callback);
      message.on("response", function (peer, response) {
        if (!done) {
          done = true;
          callback(null, peer, response);
        }
      });
      networkManager.send(message);
    });
  };

  /** Sets up the item's readable stream to take content from the specified
   * peer. The item will be stored into a temporary file while reading, so
   * the next time it's required it will be retrieved from the file system.
   *
   * @param {DataStoreItem} item Item get from the remote machine. Cannot be
   *    null.
   * @param {Peer} peer Peer that contains the remote item to download. Cannot
   *    be null.
   * @param {Object} serverInfo Remote item descriptor as it was
   *    provided by the peer in a previous lookup. Cannot be null.
   * @param {Function} callback Callback invoked when the download stream is
   *    setup for the item. It takes an error and the item as parameters. Cannot
   *    be null.
   * @private
   * @methodOf NetworkDevice#
   */
  var createContentStream = function (item, peer, serverInfo, callback) {
    var fileName = base.getFile(item);
    var options = {
      hostname: peer.address,
      port: serverInfo.port,
      path: "/",
      headers: {
        target: peer.id,
        item: JSON.stringify({
          id: item.getId(),
          metadata: item.getMetadata(),
          status: item.status(base)
        })
      }
    };
    var client = http.request(options, function (res) {
      var writeStream = fs.createWriteStream(fileName);
      var errorMessage = "";

      res.on('end', function () {
        if (res.statusCode === 200) {
          writeStream.end();
          callback(null, item);
        } else {
          fs.unlinkSync(fileName);
          if (res.statusCode === 500) {
            callback(new Error(errorMessage), null);
          } else {
            callback(new Error("Bad response."), null);
          }
        }
      });
      res.on("data", function (chunk) {
        if (res.statusCode === 200) {
          writeStream.write(chunk);
        } else {
          errorMessage += chunk;
        }
      });

      item.stream = function () {
        return fs.createReadStream(fileName);
      };
    });

    client.on("error", function (err) {
      callback(err, null);
    });
    client.end();
  };

  /** Initializes the HTTP server to send requested files.
   * @param {Function} initCallback Callback invoked when the content server is
   *    ready. Cannot be null.
   */
  var initServer = function (initCallback) {
    networkManager.createHttpServer(function (req, res) {
      var rawItem = JSON.parse(req.headers.item);
      var item = new DataStoreItem(rawItem.id, rawItem.metadata, rawItem.status);

      if (req.headers.target === networkManager.getLocalNode().id) {
        LOG.debug("Download request received from " + req.socket.remoteAddress +
          ":" + req.socket.remotePort);

        get(item, function (err) {
          if (err) {
            res.writeHead(500);
            res.end(err.message);
          } else {
            item.stream().pipe(res);
          }
        });
      }
    }, function (err, port) {
      serverPort = port;
      initCallback(err);
    });
  };

  return extend(base, {

    /** Initializes this network device, it must be invoked in order to join
     * the peer network.
     * @param {Function} callback Callback notified when the device is already
     *    initialized. It takes an error as parameter. Cannot be null.
     */
    initialize: function (callback) {
      initServer(function (err) {
        if (err) {
          callback(err);
        } else {
          networkManager.addMessageHandlers(DEVICE_ID, MessageHandlers);
          callback(null);
        }
      });
    },

    /** Returns the device unique id.
     * @return {String} Returns the device id. Never returns null or empty.
     */
    getId: function () {
      return DEVICE_ID;
    },

    /** Opens a connection to the specified item and notifies when connection
     * is ready.
     * @param {DataStoreItem} item Item to open. Cannot be null.
     * @param {Function} callback Function invoked to notify when the connection
     *    is opened. It takes an error and the item as parameters. Cannot be
     *    null.
     */
    get: function (item, callback) {
      exists(item, function (itemExists) {
        if (itemExists) {
          get(item, callback);
        } else {
          // Item doesn't exist in the local device, let's pick it from the peer
          // network.
          findItemAndWait(item, function (err, peer, serverInfo) {
            if (err) {
              callback(err, null);
            } else {
              createContentStream(item, peer, serverInfo, callback);
            }
          });
        }
      });
    },

    /** Indicates whether the specified item exists in the device or not. This
     * validation could be offline depending on the device implementation.
     *
     * @param {DataStoreItem} item Item to validate. Cannot be null.
     * @param {Function} callback Callback to notify whether the item exists or
     *    not. It receives a boolean as parameter. Cannot be null.
     */
    exists: function (item, callback) {
      index.getItem(item.getId(), function (err) {
        callback(err == null);
      });
    }
  });
};
