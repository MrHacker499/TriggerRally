// Copyright (C) 2012 jareiko / http://www.jareiko.net/

/*

[
  {
    name: "height-source"
    type: "imagedata"
  }
  {
    name: "tHeight"
    type: ""
  }
]

*/

define([
  'async'
], function(async) {
  var quiver = {};

  var _getUniqueId = (function() {
    var nextId = 0;
    return function() {
      return ++nextId;
    };
  })();

  var _pluck = function(arr, property) {
    var result = [], i, l;
    for (i = 0, l = arr.length; i < l; ++i) {
      result.push(arr[i][property]);
    }
    return result;
  }

  var _callAll = function(arr) {
    for (var i = 0, l = arr.length; i < l; ++i) {
      arr[i]();
    }
  }

  /*
  async's queue introduces latency with nextTick.
  quiver.Lock = function() {
    this.queue = new async.queue(function(task, callback) {
      task(null, callback);
    }, 1);
  };

  quiver.Lock.prototype.acquire = function(callback) {
    this.queue.push(callback);
  };
  */

  quiver.Lock = function() {
    // The first callback in the queue is always the one currently holding the lock.
    this.queue = [];
  };

  // callback(release)
  quiver.Lock.prototype.acquire = function(callback) {
    var q = this.queue;
    function release() {
      q.shift();
      if (q.length > 0) {
        // Call the next waiting callback.
        q[0](release);
      }
    }
    q.push(callback);
    if (q.length === 1) {
      callback(release);
    }
  };

  quiver.Lock.prototype.isLocked = function() {
    return this.queue.length > 0;
  };

  quiver.connect = function() {
    var prevNodes, prevOp;
    var i, arg, anonNodes;

    function connectNodes(nodes) {
      if (prevOp) {
        prevOp.addOutNodes.apply(op, nodes);
        prevOp = null;
      }
      prevNodes = nodes;
    }

    function connectOperation(op) {
      if (prevOp) {
        connectNodes(prevNodes)
        // Create an anonymous intermediate node.
        prevNodes = [new quiver.Node()];
      }
      if (prevNodes) {
        op.addInNodes.apply(op, prevNodes);
      }
      prevOp = op;
    }

    for (i = 0; i < arguments.length; ++i) {
      arg = arguments[i];
      if (arg instanceof quiver.Operation) {
        connectOperation(arg);
      } else if (arg instanceof Function) {
        connectOperation(new quiver.Operation(arg));
      } else if (arg instanceof quiver.Node) {
        connectNodes([arg]);
      } else if (arg instanceof Array) {
        connectNodes(arg);
      } else if (arg instanceof Object) {
        connectNodes([new Node(arg)]);
      } else if (typeof arg === 'number') {
        anonNodes = [];
        while (arg--) anonNodes.push(new quiver.Node());
        connectNodes(anonNodes);
      } else {
        // Ignore unrecognized arguments.
        // Should this throw an error?
      }
    }
  };

  quiver.Node = function(opt_payload) {
    this.payload = opt_payload || {};
    this.dirty = false;
    this.inputs = [];
    this.outputs = [];
    this.lock = new quiver.Lock();
    this.id = _getUniqueId();
  };

  quiver.Node.prototype.addInputs = function() {
    this.inputs.push.apply(this.inputs, arguments);
  };

  quiver.Node.prototype.addOutputs = function() {
    this.outputs.push.apply(this.outputs, arguments);
  };

  quiver.Node.prototype.markDirty = function(visited) {
    visited = visited || {};
    if (visited[this.id]) {
      throw new Error('Circular dependency detected.');
    }
    visited[this.id] = true;
    for (var i = 0; l = this.outputs.length; i < l; ++i) {
      this.outputs[i].markDirty(visited);
    });
  };

  // callback(err, release, payload)
  quiver.Node.prototype.acquire = function(callback) {
    this.lock.acquire(function(release) {
      var tasks = [], releaseCallbacks = [];
      function fullRelease() {
        _callAll(releaseCallbacks);
        release();
      }
      function ready(inputPayloads, cb) {
        if (this.payload instanceof Function) {
          var outputPayloads = _pluck(this.outputs, 'payload');
          this.payload(inputPayloads, outputPayloads, function(err) {
            if (err) {
              fullRelease();
              cb(err);
            } else {
              cb(null, fullRelease, true);
            }
          });
        } else {
          cb(null, fullRelease, this.payload);
        }
      }
      if (this.dirty || this.payload instanceof function) {
        // We need to acquire our inputs first.
        for (var i = 0; l = this.inputs.length; i < l; ++i) {
          var input = this.inputs[i];
          task.push(function(cb) {
            input.acquire(function(err, release, payload) {
              releaseCallbacks.push(release);
              cb(err, payload);
            });
          });
        });
        async.parallel(tasks, function(err, inputPayloads) {
          if (err) {
            _callAll(releaseCallbacks);
            callback(err);
          } else {
            ready(inputPayloads, function(err, release, cb) {
              ;
            });
          }
        });
      } else {
        // This is a clean non-function Node, so we don't need to acquire inputs.
        callback(null, release, this.payload);
      }
    });
  };

  quiver.Operation = function(func) {
    this.id = getUniqueId();
    this.inputs = [];
    this.outputs = [];
    this.func = func;
    this.dirty = false;
    this.lock = new quiver.Lock();
    // Cached values for passing to func.
    this.ins = [];
    this.outs = [];
  };

  quiver.Operation.prototype.addInNode = function(node) {
    this.inputs.push(node);
    this.ins.push(node.object);
    node._addOutOp(this);
  };

  quiver.Operation.prototype.addOutNode = function(node) {
    this.outputs.push(node);
    this.outs.push(node.object);
    node._addInOp(this);
  };

  quiver.Operation.prototype.markDirty = function(visited) {
    visited = visited || {};
    if (!this.dirty) {
      this.dirty = true;
      for (var i = 0, l = this.outputs.length; i < l; ++i) {
        this.outputs[i].markDirty();
      }
    }
  };

  quiver.Operation.prototype.processIfDirty = function(callback) {
    this.lock.acquire(function(release) {
      if (this.dirty) {
        async.forEach(this.inputs, function(inNode, cb) {
          inNode.get(cb);
        }, function(err) {
          this.func(this.ins, this.outs, callback);
          this.dirty = false;
          release();
        });
      } else {
        release();
      }
    });
  };









  var inNode = (typeof Image === 'undefined');
  if (inNode) {
    // Running in Node.js.
    var Canvas = require('canvas');
  }

  function assert(val, msg) {
    if (!val) throw new Error(msg || 'Assert failed.');
  }

  function channels(buffer) {
    return buffer.data.length / buffer.width / buffer.height;
  }

  function ensureDims(buffer, width, height, channels, type) {
    if (!buffer.data ||
        buffer.width != width ||
        buffer.height != height) {
      buffer.width = width;
      buffer.height = height;
      buffer.data = new type(width * height * channels);
    }
  }

  function buffer2DFromImage(params) {
    params = params || {};
    return function(ins, outs) {
      assert(ins.length === 1, 'Wrong number of inputs.');
      assert(outs.length === 1, 'Wrong number of outputs.');
      var image = ins[0];
      var cx = image.width;
      var cy = image.height;
      var canvas;
      if (inNode) {
        canvas = new Canvas(cx, cy);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = cx;
        canvas.height = cy;
      }
      var ctx = canvas.getContext('2d');
      if (params.flip) {
        ctx.translate(0, cy);
        ctx.scale(1, -1);
      }
      ctx.drawImage(image, 0, 0);
      var data = ctx.getImageData(0, 0, cx, cy);
      outs[0].width = data.width;
      outs[0].height = data.height;
      // TODO: Add dirty rectangle support.
      // This swap-buffer approach may be better anyway.
      outs[0].data = data.data;
    };
  }

  function unpack16bit() {
    return function(ins, outs, callback, dirty) {
      assert(ins.length === 1, 'Wrong number of inputs.');
      assert(outs.length === 1, 'Wrong number of outputs.');
      var src = ins[0], dst = outs[0];
      assert(src.width  === dst.width );
      assert(src.height === dst.height);
      var srcData = src.data, dstData = dst.data;
      var srcChannels = channels(src);
      assert(srcChannels >= 2);
      ensureDims(dst, src.width, src.height, 1, Uint16Array);
      var minX = 0, minY = 0, maxX = src.width, maxY = src.height;
      if (dirty) {
        minX = dirty.x;
        minY = dirty.y;
        maxX = minX + dirty.width;
        maxY = minY + dirty.height;
      }
      var sX, sY, srcPtr, dstPtr;
      for (sY = minY; sY < maxY; ++sY) {
        srcPtr = (sY * src.width) * srcChannels;
        dstPtr = (sY * dst.width);
        for (sX = minX; sX < maxX; ++sX) {
          dst[dstPtr] = src[srcPtr] + src[srcPtr + 1] * 256;
          srcPtr += srcChannels;
          dstPtr += 1;
        }
      }
      callback();
    }
  }

  src = new quiver.Node(img);
  var hmap = {};  // Shared object.
  hm1 = new quiver.Node(hmap);
  hm2 = new quiver.Node(hmap);
  surf = new quiver.Node();
  quiver.connect(src, buffer2DFromImage({flip:true}), unpack16bit(), hm1);
  quiver.connect(hm1, drawTrack(), [hm2, surf]);
  quiver.connect(hm2, derivatives(), surf);
  // or without connect:
  step = new quiver.Operation(buffer2DFromImage({flip:true}));
  step.addInNodes(src);
  step.addOutNodes(hm)

  hm.get(function(err, tHeight) {
    if (err) throw new Error(err);
  });

  /*
  Stuff to document and test:

  3-arg connect
  2-arg connect (op, [node, node])
  5-arg connect
  4-arg connect
  Creating two nodes with the same object
  Setup without connect?
  Async ops and locking
  */

  return quiver;
});
