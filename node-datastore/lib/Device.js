/** Data store Device abstraction layer. It's responsible of putting, getting,
 * deleting and checking physical items.
 * @param {String} id Device unique id. Cannot be null or empty.
 * @constructor
 */
module.exports = function Device (id) {

  return {

    /** Returns the device unique id.
     * @return {String} Returns the device id. Never returns null or empty.
     */
    getId: function () {
      return id;
    },

    /** Sends the item to this device. It updates the item to reflect the
     * status on this device.
     * @param {DataStoreItem} item Item to send. Cannot be null.
     * @param {Function} callback Callback invoked when the operation has
     *    finished. It takes an error and the item as parameter. Cannot be null.
     */
    put: function (item, callback) {
      throw new Error("Must be implemented by subclasses.");
    },

    /** Opens a connection to the specified item and notifies when connection
     * is ready.
     * @param {DataStoreItem} item Item to open. Cannot be null.
     * @param {Function} callback Function invoked to notify when the connection
     *    is opened. It takes an error and the item as parameters. Cannot be
     *    null.
     */
    get: function (item, callback) {
      throw new Error("Must be implemented by subclasses.");
    },

    /** Determines whether this device is available or not.
     * @param {Function} callback Callback invoked to notify whether the device
     *    is available or not. It takes a boolean parameter. Cannot be null.
     */
    ping: function (callback) {
      throw new Error("Must be implemented by subclasses.");
    },

    /** Indicates whether the specified item exists in the device or not. This
     * validation could be offline depending on the device implementation.
     *
     * @param {DataStoreItem} item Item to validate. Cannot be null.
     * @param {Function} callback Callback to notify whether the item exists or
     *    not. It receives a boolean and the item as parameters. Cannot be null.
     */
    exists: function (item, callback) {
      throw new Error("Must be implemented by subclasses.");
    }
  };
};
