/** Represents a data store index.
 */
module.exports = function Index () {

  return {

    /** Retrieves a single item from the index.
     *
     * @param {String} id Required item id. Cannot be null or empty.
     * @param {Function} callback Callback that receives the required item. It
     *    takes an error and the item as parameters. Cannot be null.
     */
    getItem: function (id, callback) {
      throw new Error("Must be implemented by subclasses");
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
      throw new Error("Must be implemented by subclasses");
    },

    /** Flushes the index in order to save all changes still in memory.
     * @param {Function} [callback] Callback invoked when flush operation
     *    finished. It takes an error as parameter. Can be null.
     */
    flush: function (callback) {
      throw new Error("Must be implemented by subclasses");
    }
  };
};
