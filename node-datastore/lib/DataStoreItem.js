/** Represents a item saved in the DataStore.
 *
 * @param {String} id Item unique id. Cannot be null or empty.
 * @param {Object} metadata Item metadata. Cannot be null.
 * @param {Object} status Status object. Cannot be null.
 */
module.exports = function DataStoreItem (id, metadata, status) {

  return {

    /** Returns the item unique id.
     * @return {String} Returns a valid String. Never returns null or empty.
     */
    getId: function () {
      return id;
    },

    /** Returns the item metadata.
     *
     * @return {Metadata} Returns a valid metadata, never returns null.
     */
    getMetadata: function () {
      return metadata;
    },

    /** Returns a stream to read this item. Always returns a new stream.
     *
     * @return {stream.Readable} Returns a valid stream, or throws an error if
     *    this item cannot be read.
     */
    stream: function () {
      throw new Error("Item cannot be read.");
    },

    /** Sets or returns the status for the specified device.
     *
     * @param {Device} device Device to set the status for. Cannot be null.
     * @param {Number} [code] A valid HTTP status code that represents the
     *    item status in the device.
     * @param {String} [message] An optional status message. Can be null.
     */
    status: function (device, code, message) {
      if (code !== undefined) {
        status[device.getId()] = {
          code: code,
          message: message
        };
      }
      return status[device.getId()];
    }
  };
};
