/** Simple data store that uses a file system index distributed over a p2p
 * network.
 *
 * @param {String} baseDir Directory to share with the network. Cannot be null
 *    or empty.
 * @param {NetworkManager} networkManager Network manager used to handle
 *    communications between peers. It must be initialized. Cannot be null.
 * @constructor
 */
module.exports = function NetworkDataStore(baseDir) {

  /** NetworkManager constructor.
   * @type Function
   * @private
   * @fieldOf NetworkDataStore#
   */
  var NetworkManager = require("./NetworkManager");

  /** NetworkIndex constructor.
   * @type Function
   * @private
   * @fieldOf NetworkDataStore#
   */
  var NetworkIndex = require("./NetworkIndex");

  /** NetworkDevice constructor.
   * @type Function
   * @private
   * @fieldOf NetworkDataStore#
   */
  var NetworkDevice = require("./NetworkDevice");

  /** DataStore base constructor.
   * @type Function
   * @private
   * @fieldOf NetworkDataStore#
   */
  var DataStore = require("../../node-datastore/lib/DataStore");

  /** Represents the p2p network.
   * @type {Function}
   * @private
   * @fieldOf NetworkDataStore#
   */
  var Swarm = require("./Swarm");

  /** Util to extend objects.
   * @type Function
   * @private
   * @fieldOf NetworkDataStore#
   */
  var extend = require("extend");

  /** Manages peers in the current network.
   *
   * @type Object
   * @private
   * @fieldOf NetworkDataStore#
   */
  var swarm = new Swarm(baseDir);

  /** Network data store instance.
   * @private
   * @fieldOf NetworkDataStore#
   */
  var dataStore = {};

  /** Distributed index used by this data store, it's never null after
   * initialize().
   * @type {NetworkIndex}
   * @private
   * @fieldOf NetworkDataStore#
   */
  var index;

  /** Network manager used by index and device related to this data store, it's
  *  never null.
   * @type {NetworkManager}
   * @private
   * @fieldOf NetworkDataStore#
   */
  var networkManager = new NetworkManager(swarm);

  return extend(dataStore, {

    /** Initializes this data store. It creates the network manager, index and
     * device required to work over the network.
     * @param {Function} callback Callback invoked when the data store is
     *    ready. It takes an error as parameter. Cannot be null.
     * @private
     * @fieldOf NetworkDataStore#
     */
    initialize: function (callback) {
      var device;

      networkManager.initialize(function (err) {
        if (err) {
          callback(err);
        } else {
          index = new NetworkIndex(baseDir, networkManager);
          device = new NetworkDevice(baseDir, networkManager, index);
          device.initialize(function (err) {{
            extend(dataStore, new DataStore(index, [device]));
            callback(err);
          }});
        }
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
      swarm.join(peer, callback);
    },

    /** Removes the specified node from the peer network. Data related to the
     * peer will not be removed from the index.
     *
     * @param {Peer} peer Peer to remove. Cannot be null.
     * @param {Function} callback Callback to notify when the peer is removed
     *    from the peer network. It takes an error as parameter. Cannot be null.
     */
    leave: function (peer, callback) {
      swarm.leave(peer, callback);
    },

    /** Returns the current node (the one representing the local machine) from
     * the index.
     *
     * @return {Peer} Returns the peer that represents the local machine. It
     *    never returns null after initialize();
     */
    getLocalNode: function () {
      return swarm.getLocalNode();
    }
  });
};
