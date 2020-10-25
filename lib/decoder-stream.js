
/**
 * Module dependencies.
 */

const debug = require('debug')('ogg:decoder-stream');
const binding = require('./binding');
const ogg_packet = require('./packet');
const {Readable} = require('stream');

/**
 * The `DecoderStream` class is what gets passed in for the `Decoder` class'
 * "stream" event. You should not need to create instances of `DecoderStream`
 * manually.
 *
 * @api private
 */

module.exports = class DecoderStream extends Readable {
  packets;
  serialno;
  os;

  constructor(serialno) {
    super({objectMode: true, highWaterMark: 0});

    this.packets = [];
    this.serialno = serialno;

    this.os = Buffer.from(binding.sizeof_ogg_stream_state);

    const r = binding.ogg_stream_init(this.os, serialno);
    if (r !== 0) {
      throw Error(`ogg_stream_init() failed : ${r}`);
    }
  }

  /**
   * We have to overwrite the "on()" function to reinterpret "packet" event names as
   * "data" event names. Attaching a "packet" event listener will put the stream
   * into streams2 "old-mode".
   *
   * @api public
   * @param {string} ev
   * @param {Function} fn
   */
  on(ev, fn) {
    if (ev == 'packet') {
      debug(`on(): Remapping "packet" event listener as "data" event listener`);
      ev = 'data';
    }

    return super.on(ev, fn);
  }

  addListener = this.on;

  /**
   * 
   * @param {string} ev 
   * @param {Function} fn 
   */
  once(ev, fn) {
    if (ev == 'packet') {
      debug(`on(): Remapping "packet" event listener as "data" event listener`);
      ev = 'data';
    }
    
    return super.once(ev, fn);
  }

  /**
   * 
   * @param {string} ev 
   * @param {Function} fn 
   */
  off(ev, fn) {
    if (ev == 'packet') {
      debug(`on(): Remapping "packet" event listener as "data" event listener`);
      ev = 'data';
    }
    
    return super.off(ev, fn);
  }

  removeListener = this.off;

  /**
   * Calls `ogg_stream_pagein()` on this OggStream.
   * Internal function used by the `Decoder` class.
   * 
   * @param {Buffer} page `ogg_page` instance
   * @param {number} packets the number of `ogg_packet` instances in the page
   * @param {Function} callback callback function
   * @api private
   */
  pagein(page, packets, callback) {
    debug(`pagein(${packets} packets)`);

    const os = this.os;
    const self = this;

    let packet;

    binding.ogg_stream_pagein(os, page, (r) => {
      if (r === 0) {
        self.emit('page', page);

        packetOut();
      } else {
        callback(Error(`ogg_stream_pagein() error: ${r}`));
      }
    });

    function packetOut() {
      debug(`packetOut(), ${packets} packets left`);

      if (packets === 0) {
        callback();
      } else {
        packet = new ogg_packet();
        binding.ogg_stream_packetout(os, packet, afterPacketOut);
      }
    }
    
    function afterPacketOut(rtn, bytes, b_o_s, e_o_s, granulePos, packetNo) {
      debug('afterPacketout(%d, %d, %d, %d, %d, %d)', rtn, bytes, b_o_s, e_o_s, granulePos, packetNo);

      if (rtn === 1) {
        // got a packet...

        // since libogg takes control of the `packet`s "packet" data field, we must
        // copy it over to a Node.js buffer and change the pointer over. That way,
        // the `packet` Buffer is *completely* managed by the JS garbage collector

        packet.replace();

        if (b_o_s) {
          self.emit('bos');
        }
        packet._callback = afterPacketRead;
        self.packets.push(packet);
        self.emit('_packet');
      } else if (rtn === -1) {
        // libogg issued a sync warning, usually recoverable, try it again.
        // http://xiph.org/ogg/doc/libogg/ogg_stream_packetout.html
        packetOut();
      } else {
        // libogg returned an unrecoverable error
        callback(Error(`ogg_stream_packetout() error: ${rtn}`));
      }
    }

    function afterPacketRead(err) {
      debug('afterPacketRead(%s)', err);
      if (err) 
        return callback(err);

      if (packet.e_o_s) {
        self.emit('eos');
        self.push(null); // emit "end"
      }
      --packets;

      // read out the next packet from the stream
      packetOut();
    }
  }

  /**
   * Pushes the next "packet" from the "packets" array, otherwise waits for an
   * "_packet" event.
   *
   * @api private
   */
  _read(n, fn) {
    debug(`_read(${n} packets)`);

    const self = this;

    function onPacket() {
      let packet = self.packets.shift();
      let callback = packet._callback;
      packet._callback = null;

      if (self.push) 
        self.push(packet);
      else
        fn(null, packet);

      if (callback) process.nextTick(callback);
    }

    if (this.packets.length > 0) {
      onPacket.call(this);
    } else {
      this.once('_packet', onPacket);
    }
  }
}
