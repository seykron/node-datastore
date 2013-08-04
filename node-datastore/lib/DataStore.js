/** Data store that saves content into different devices. Devices provide access
 * to physical storage while this abstract storage keeps track of items and
 * it manages the main index.
 *
 * When items are saved they are replicated into all supported devices. Devices
 * are responsible to tell which items are supported or not. Items are always
 * saved to the index, either the physical item is successfully saved or not.
 * If a single device fails, the item will be flagged with error for that device
 * and could be saved later by calling <code>sync(id)</code>. If a device fails
 * and the item doesn't exist in any other device, it will be flagged as missing
 * in the index. Missing items are re-attached later when they're saved again.
 * If the index fails, items will no be written to devices and it's considered
 * an unrecoverable error.
 *
 * Items are unique in the data store. The content is hashed to represent a
 * unique physical element. Items also support namespaces. A namespace is
 * another representation of the same item. Namespaces and main items are
 * treated as composite key, this means namespaces are not hashed so the same
 * namespace in different items will represent different physical resources.
 *
 * Items are retrieved from the first available device. This data store does
 * not support any strategy to choose a specific device. Available means the
 * first device from the list that answers a <code>ping()</code> request. It
 * depends on device implementation.
 *
 * Delete is always logical. Items are physically removed from devices and then
 * flagged as deleted in the index. They will remain available in the index
 * unless <code>purge()</code> is used. After purging, any item that failed to
 * be deleted from a device will be orphan in that device. This data store does
 * not provide any strategy to find orphan items (maybe Index implementations
 * will do). Namespaces are also removed from physical devices but kept in the
 * index.
 *
 * Synchronization is triggered via <code>sync()</code>. This process replicates
 * and deletes items into/from failed devices. Errors during synchronization
 * will be reported but ignored by the process.
 *
 * @param {Index} index Index to save items meta data. Cannot be null.
 * @param {Device[]} devices List of devices supported by this data store.
 *    Cannot be null.
 * @param {Function} [options.errorHandler] Function notified when there's an
 *    error processing an item. It receives the error, item id, namespace and
 *    error type as parameters. Error types could be <code>get</code>,
 *    <code>delete</code>, <code>save</code> or <code>sync</code>.
 * @constructor
 */
module.exports = function DataStore(index, devices, options) {

  /** Node file system API.
   * @type {Object}
   * @private
   * @fieldOf DataStore#
   */
  var fs = require("fs");

  /** Node path API.
   * @type {Object}
   * @private
   * @fieldOf DataStore#
   */
  var path = require("path");

  /** Node file crypto API.
   * @type {Object}
   * @private
   * @fieldOf DataStore#
   */
  var crypto = require("crypto");

  /** Node operating system API.
   * @type {Object}
   * @private
   * @fieldOf DataStore#
   */
  var os = require("os");

  /** Async utility library.
   * @type {Object}
   * @private
   * @fieldOf DataStore#
   */
  var async = require("async");

  /** Node Writable stream.
   * @type {Function}
   * @private
   * @fieldOf DataStore#
   */
  var Writable = require("stream").Writable;

  /** Composes a valid item id from its base identifier and the namespace.
   * @param {String} id Item unique id. Cannot be null or empty.
   * @param {String} [namespace] Item namespace. Can be null.
   * @return {String} Returns the item composite id. Never returns null or
   *    empty.
   */
  var composeId = function (id, namespace) {
    var itemId = id;

    if (namespace) {
      itemId += "_" + namespace;
    }

    return itemId;
  };

  /** Reads the stream to generate the item id and creates the temporary swap
   * stream.
   *
   * @param {stream.Readable} stream Stream to read. Cannot be null.
   * @param {String} namespace Item namespace, if any. Can be null.
   * @param {Function} callback Function invoked when stream is read. It takes
   *    the item id and the temporary swap stream as parameters.
   * @private
   * @methodOf DataStore#
   */
  var generateId = function (stream, namespace, callback) {
    var hash = crypto.createHash("sha256");
    var fileId = new Date().getTime() * Math.random() * 31;
    var tempFile = path.join(os.tmpDir(), fileId + ".dstemp");
    var swap = fs.createWriteStream(tempFile);
    var proxy = new Writable({
      decodeStrings: false
    });

    proxy._write = function (chunk, encoding, callback) {
      hash.update(chunk);

      return swap.write(chunk, encoding, callback);
    };

    stream.on('end', function () {
      var id = composeId(hash.digest('hex'), namespace);

      callback(id, tempFile);
    });
    stream.pipe(proxy);
  };

  /** Sends an item to the specified device.
   * @param {Device} device Device to send the item to. Cannot be null.
   * @param {DataStoreItem} item Item to send. Cannot be null.
   */
  var sendToDevice = function (device, item, callback) {
    device.put(item, callback);
  };

  return {

    /** Saves a resource and creates a new item.
     *
     * @param {stream.Readable} stream Stream to read item content. Cannot be
     *    null.
     * @param {String} namespace Item namespace, if any. Can be null.
     * @param {Object} metadata Item metadata. Cannot be null.
     * @param {Function} callback Function to receive the new item. It takes
     *    and error and the item as parameters. Cannot be null.
     */
    save: function (stream, namespace, metadata, callback) {
      generateId(stream, namespace, function (id, swapFile) {
        index.createItem(id, metadata, function (err, item) {
          var sendQueue = [];
          var hasError = false;

          if (err) {
            callback(err);
            return;
          }

          item.stream = function () {
            return fs.createReadStream(swapFile);
          };

          devices.forEach(function (device) {
            sendQueue.push(sendToDevice.bind(this, device, item));
          });

          async.parallel(sendQueue, function (err, results) {
            if (!results && err && options && options.errorHandler) {
              hasError = true;
              return options.errorHandler(err, id, namespace, "save");
            }
            fs.unlinkSync(swapFile);
            if (hasError) {
              callback(new Error("Item could not be sent to some devices"),
                item);
            } else {
              callback(null, item);
            }
          });
        })
      });
    },

    /** Returns a single item from the data store.
     *
     * @param {String} id Id of the required item.
     * @param {String} namespace The required item namespace, if any. Can be
     *    null.
     * @param {Function} callback Function that receives the required item. It
     *    takes an error and the required item as parameters. Cannot be null.
     */
    get: function (id, namespace, callback) {
      index.getItem(composeId(id, namespace), function (err, item) {
        if (err) {
          callback(err);
          return;
        }
        async.detect(devices, function (device, deviceCallback) {
          device.ping(function (available) {
            if (available) {
              device.exists(item, deviceCallback);
            } else {
              deviceCallback(false);
            }
          });
        }, function (availableDevice) {
          if (!availableDevice) {
            callback(new Error(
              "There's no available device to retrieve the item."))
          } else {
            availableDevice.get(item, callback);
          }
        });
      });
    },

    /** Deletes a single item or any of its namespaces.
     *
     * @param {String} id Id of the item to delete. Cannot be null.
     * @param {String} namespace If specified, it deletes only the item
     *    namespace. Can be null.
     * @param {Function} callback Function invoked when item is deleted. It
     *    takes an error as parameter. Cannot be null.
     */
    delete: function (id, namespace, callback) {
      throw new Error("No yet implemented!");
    },

    /** Synchronizes either a single item or the full data store. If no item id
     * is provided, it synchronized the full data store. Be careful, this
     * operation could be expensive and it cannot be stopped.
     *
     * @param {String} [id] Id of the item to synchronize.
     * @param {Function} [callback] Callback invoked when synchronization
     *    finished. Can be null.
     */
    sync: function (id, callback) {
      throw new Error("No yet implemented!");
    },

    /** Removes deleted and missing items from the index.
     * @param {Function} [callback] Function invoked when purging finished. Can
     *    be null.
     */
    purge: function (callback) {
      throw new Error("No yet implemented!");
    },

    /** Closes the data store and flushes the index.
     * @param {Function} [callback] Callback invoked when data store is already
     *    closed. It takes an error as parameter. Can be null.
     */
    close: function (callback) {
      index.flush(callback);
    }
  };
};
