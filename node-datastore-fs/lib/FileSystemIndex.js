/** Index to manage content in the file system. It stores the index in a plain
 * object and saves it serialized as JSON. The index file is loaded into memory
 * when this class is instantiated.
 *
 * @param {String} baseDir Base directory to index file. Cannot be null or
 *    empty.
 * @constructor
 * @augments Index
 */
module.exports = function FileSystemIndex (baseDir) {

  /** Name of the index file.
   * @constant
   * @private
   * @fieldOf FileSystemIndex#
   */
  var INDEX_FILE = "index.json";

  /** Index base constructor.
   * @type Function
   * @private
   * @fieldOf FileSystemIndex#
   */
  var Index = require("../../node-datastore/lib/Index");

  /** DataStoreItem constructor.
   * @type Function
   * @private
   * @fieldOf FileSystemIndex#
   */
  var DataStoreItem = require("../../node-datastore/lib/DataStoreItem");

  /** Node file system API.
   * @type {Object}
   * @private
   * @fieldOf FileSystemIndex#
   */
  var fs = require("fs");

  /** Node path API.
   * @type {Object}
   * @private
   * @fieldOf FileSystemIndex#
   */
  var path = require("path");

  /** Util to extend objects.
   * @type Function
   * @private
   * @fieldOf FileSystemIndex#
   */
  var extend = require("extend");

  /** mkdirp utility.
   * @type {Function}
   * @private
   * @fieldOf FileSystemIndex#
   */
  var mkdirp = require('mkdirp');

  /** Opens and reads the full index into memory.
   * @type Object
   * @private
   * @fieldOf FileSystemIndex#
   */
  var index = (function () {
    var indexFile = path.join(baseDir, INDEX_FILE);

    if (!fs.existsSync(baseDir)) {
      mkdirp(baseDir);
    }

    if (fs.existsSync(indexFile)) {
      return JSON.parse(fs.readFileSync(indexFile));
    } else {
      return {};
    }
  }());

  /** Writes the current index state to the file system.
   * @param {Function} callback Callback invoked when the index is saved. Cannot
   *    be null.
   * @private
   * @methodOf FileSystemIndex#
   */
  var saveIndex = function (callback) {
    var indexFile = path.join(baseDir, INDEX_FILE);

    fs.writeFile(indexFile, JSON.stringify(index), callback);
  };

  return extend(new Index(), {

    /** Retrieves a single item from the index.
     *
     * @param {String} id Required item id. Cannot be null or empty.
     * @param {Function} callback Callback that receives the required item. It
     *    takes an error and the item as parameters. Cannot be null.
     */
    getItem: function (id, callback) {
      var item;

      if (index.hasOwnProperty(id)) {
        item = index[id];
        callback(null, new DataStoreItem(item.id, item.metadata, item.status));
      } else {
        callback(new Error("Item " + id + " not found in the index."));
      }
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
      var item = {
        id: id,
        metadata: metadata,
        status: {}
      };
      index[id] = item;

      // TODO (seykron): performance sucks, let's change it to something clever.
      saveIndex(function (err) {
        callback(err, new DataStoreItem(id, metadata, item.status));
      });
    },

    /** Flushes the index in order to save all changes still in memory.
     * @param {Function} [callback] Callback invoked when flush operation
     *    finished. It takes an error as parameter. Can be null.
     */
    flush: function (callback) {
      saveIndex(function (err) {
        if (callback) {
          callback(err);
        }
      });
    }
  });
};
