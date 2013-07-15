/** Device to manage content in the file system.
 *
 * @param {String} baseDir Base directory to read and write the items to. Cannot
 *    be null or empty.
 * @constructor
 * @augments Device
 */
module.exports = function FileSystemDevice (baseDir) {

  /** Device unique id.
   * @constant
   * @private
   * @fieldOf FileSystemDevice#
   */
  var DEVICE_ID = "FileSystemDevice";

  /** Device base constructor.
   * @type Function
   * @private
   * @fieldOf FileSystemDevice#
   */
  var Device = require("../../node-datastore/lib/Device");

  /** Util to extend objects.
   * @type Function
   * @private
   * @fieldOf FileSystemDevice#
   */
  var extend = require("extend");

  /** Node file system API.
   * @type {Object}
   * @private
   * @fieldOf DataStore#
   */
  var fs = require("fs");

  /** Node path API.
   * @type {Object}
   * @private
   * @fieldOf FileSystemDevice#
   */
  var path = require("path");

  /** mkdirp utility.
   * @type {Function}
   * @private
   * @fieldOf FileSystemDevice#
   */
  var mkdirp = require('mkdirp');

  /** Builds the full path to the specified item.
   * @param {DataStoreItem} item Item to build full path. Cannot be null.
   * @return {String} Returns the item full path. Never returns null or empty.
   */
  var buildFullPath = function (item) {
    var root = item.getId().substr(0, 2);
    var first = item.getId().substr(2, 4);
    var second = item.getId().substr(4, 6);
    var dir = path.join(baseDir, root, first, second);

    if (!fs.existsSync(dir)) {
      mkdirp.sync(dir);
    }
    return path.join(dir, item.getId());
  };

  return extend(new Device(DEVICE_ID), {

    /** Sends the item to this device. It updates the item to reflect the
     * status on this device.
     * @param {DataStoreItem} item Item to send. Cannot be null.
     * @param {Function} callback Callback invoked when the operation has
     *    finished. It takes an error and the item as parameter. Cannot be null.
     */
    put: function (item, callback) {
      var fullPath = buildFullPath(item);
      var writeStream = fs.createWriteStream(fullPath);
      var errorCallback = function (err) {
        item.status(this, 500, err);
        callback(err, item);
      }.bind(this);

      item.stream().on("error", errorCallback);
      writeStream.on("error", errorCallback);
      writeStream.on("close", function () {
        item.status(this, 200);
        callback(null, item);
      }.bind(this));

      item.stream().pipe(writeStream);
    },

    /** Opens a connection to the specified item and notifies when connection
     * is ready.
     * @param {DataStoreItem} item Item to open. Cannot be null.
     * @param {Function} callback Function invoked to notify when the connection
     *    is opened. It takes an error and the item as parameters. Cannot be
     *    null.
     */
    get: function (item, callback) {
      var fullPath = buildFullPath(item);
      item.stream = fs.createReadStream(fullPath);
      callback(null, item);
    },

    /** Determines whether this device is available or not.
     * @param {Function} callback Callback invoked to notify whether the device
     *    is available or not. It takes a boolean parameter. Cannot be null.
     */
    ping: function (callback) {
      callback(true);
    },

    /** Indicates whether the specified item exists in the device or not. This
     * validation could be offline depending on the device implementation.
     *
     * @param {DataStoreItem} item Item to validate. Cannot be null.
     * @param {Function} callback Callback to notify whether the item exists or
     *    not. It receives a boolean and the item as parameters. Cannot be null.
     */
    exists: function (item, callback) {
      var fullPath = buildFullPath(item);
      fs.exists(fullPath, callback);
    }
  });
};
