/**
 * @author jareiko / http://www.jareiko.net/
 */

define([
  'THREE',
  'util/pubsub',
  'util/util'
],
function(THREE, pubsub, util) {
  var exports = {};

  var Vec3 = THREE.Vector3;
  var Quat = THREE.Quaternion;

  var QuatFromEuler = util.QuatFromEuler;

  var tmpVec3a = new Vec3();
  var tmpVec3b = new Vec3();
  var tmpQuat = new Quat();

  exports.Sim = function(timeStep) {
    this.gravity = new Vec3(0, 0, -9.81);
    this.objects = [];
    this.staticObjects = [];  // Just used for clipping.
    this.timeStep = timeStep;
    this.restart();
    this.pubsub = new pubsub.PubSub();
    this.on = this.pubsub.subscribe.bind(this.pubsub);
  };

  exports.Sim.prototype.restart = function() {
    this.time = 0;
    this.timeAccumulator = 0;
    this.alpha = 0;
  };

  exports.Sim.prototype.addObject = function(obj) {
    this.objects.push(obj);
  };

  exports.Sim.prototype.addStaticObject = function(obj) {
    this.staticObjects.push(obj);
  };

  exports.Sim.prototype.tick = function(delta) {
    // We can't step backwards.
    if (delta <= 0) return;
    // Cap to 10 FPS.
    if (delta > 0.1) delta = 0.1;
    var timeStep = this.timeStep;

    this.timeAccumulator += delta;
    while (this.timeAccumulator >= timeStep) {
      this.timeAccumulator -= timeStep;
      this.step();
    };
    // Cache interpolated state.
    this.alpha = this.timeAccumulator / timeStep;
    this.objects.forEach(function(object) {
      if (typeof object.getState === 'function') {
        object.interp = object.getState();
      }
    });
  };

  exports.Sim.prototype.step = function() {
    this.pubsub.publish('step');
    this.integrate(this.timeStep);
    this.time += this.timeStep;
  };

  exports.Sim.prototype.interpolatedTime = function() {
    return this.time + this.timeAccumulator;
  };

  exports.Sim.prototype.integrate = function(delta) {
    // TODO: Automatically recordState as part of object tick?
    this.objects.forEach(function(object) {
      if (typeof object.recordState === 'function') {
        object.recordState();
      }
    });
    this.objects.forEach(function(object) {
      object.tick(delta);
    });
  };

  // Collide a point against registered static objects.
  exports.Sim.prototype.collidePoint = function(pt) {
    var contacts = [];
    this.staticObjects.forEach(function(obj) {
      if (obj.getContact) {
        var contact = obj.getContact(pt);
        if (contact) {
          tmpVec3a.sub(contact.surfacePos, pt)
          contact.depth = tmpVec3a.dot(contact.normal);
          if (contact.depth > 0) {
            contacts.push(contact);
          }
        }
      }
    });
    return contacts;
  };

  // Collide a sphere list against registered static objects.
  exports.Sim.prototype.collideSphereList = function(sphereList) {
    var contactsArrays = [];
    // Collide points first.
    var tmpVec3 = new Vec3();
    var offset = new Vec3(0, 0, -sphereList.radius).addSelf(sphereList.bounds.center);
    sphereList.points.forEach(function(point) {
      tmpVec3.add(point, offset);
      tmpVec3.z -= point.radius;
      contactsArrays.push(this.collidePoint(tmpVec3));
    }, this);
    // Then collide sphere lists.
    this.staticObjects.forEach(function(obj) {
      if (obj.collideSphereList) {
        contactsArrays.push(obj.collideSphereList(sphereList));
      }
    });
    return [].concat.apply([], contactsArrays);
  };

  exports.ReferenceFrame = function() {
    // Position in 3-space.
    this.pos = new Vec3();
    // Orientation.
    this.ori = new Quat();

    // Matrix forms of orientation.
    this.oriMat = new THREE.Matrix4();
    this.oriMatInv = new THREE.Matrix4();
  };

  exports.ReferenceFrame.prototype.updateMatrices = function() {
    this.ori.normalize();
    this.oriMat.setRotationFromQuaternion(this.ori);
    this.oriMatInv.copy(this.oriMat).transpose();
  };

  // Coordinate space transforms.
  var tmpVec3c = new Vec3();
  exports.ReferenceFrame.prototype.getLocToWorldVector = function(vec) {
    var v = tmpVec3c.copy(vec);
    this.oriMat.multiplyVector3(v);
    return v;
  };
  var tmpVec3d = new Vec3();
  exports.ReferenceFrame.prototype.getWorldToLocVector = function(vec) {
    var v = tmpVec3d.copy(vec);
    this.oriMatInv.multiplyVector3(v);
    return v;
  };
  var tmpVec3e = new Vec3();
  exports.ReferenceFrame.prototype.getLocToWorldPoint = function(pt) {
    var v = tmpVec3e.copy(pt);
    this.oriMat.multiplyVector3(v);
    v.addSelf(this.pos);
    return v;
  };
  var tmpVec3f = new Vec3();
  exports.ReferenceFrame.prototype.getWorldToLocPoint = function(pt) {
    var v = tmpVec3f.sub(pt, this.pos);
    this.oriMatInv.multiplyVector3(v);
    return v;
  };

  exports.RigidBody = function(sim) {
    exports.ReferenceFrame.call(this);

    this.sim = sim;
    sim.addObject(this);

    this.angMass = new Vec3();
    this.angMassInv = new Vec3();
    this.setMassCuboid(1, new Vec3(1,1,1));

    // Linear and angular velocity.
    this.linVel = new Vec3();
    this.angVel = new Vec3();
    this.angMom = new Vec3();  // angVel is derived from this.

    // World space accumulators, zeroed after each integration step.
    this.accumForce = new Vec3();
    this.accumTorque = new Vec3();

    // Used for state recording.
    this.old = {
      pos: new Vec3(),
      ori: new Quat(),
      linVel: new Vec3(),
      angVel: new Vec3()
    };
    this.recordState();
  };
  exports.RigidBody.prototype = Object.create(new exports.ReferenceFrame());

  exports.RigidBody.prototype.recordState = function() {
    // Copy current state so that we can refer to it later.
    this.old.pos.copy(this.pos);
    this.old.ori.copy(this.ori);
    this.old.linVel.copy(this.linVel);
    this.old.angVel.copy(this.angVel);
  };

  exports.RigidBody.prototype.getState = function() {
    var a = this.old, b = this, alpha = this.sim.alpha;
    return {
      pos: new Vec3(
          a.pos.x + (b.pos.x - a.pos.x) * alpha,
          a.pos.y + (b.pos.y - a.pos.y) * alpha,
          a.pos.z + (b.pos.z - a.pos.z) * alpha),
      ori: new Quat(
          a.ori.x + (b.ori.x - a.ori.x) * alpha,
          a.ori.y + (b.ori.y - a.ori.y) * alpha,
          a.ori.z + (b.ori.z - a.ori.z) * alpha,
          a.ori.w + (b.ori.w - a.ori.w) * alpha),
      linVel: new Vec3(
          a.linVel.x + (b.linVel.x - a.linVel.x) * alpha,
          a.linVel.y + (b.linVel.y - a.linVel.y) * alpha,
          a.linVel.z + (b.linVel.z - a.linVel.z) * alpha),
      angVel: new Vec3(
          a.angVel.x + (b.angVel.x - a.angVel.x) * alpha,
          a.angVel.y + (b.angVel.y - a.angVel.y) * alpha,
          a.angVel.z + (b.angVel.z - a.angVel.z) * alpha)
    };
  };

  exports.RigidBody.prototype.setMassCuboid = function(mass, radiusVec) {
    if (mass <= 0 ||
        radiusVec.x <= 0 ||
        radiusVec.y <= 0 ||
        radiusVec.z <= 0) return;

    this.mass = mass;

    var fudgedMass = mass * 1.5;

    var mx = radiusVec.x * radiusVec.x * fudgedMass / 3;
    var my = radiusVec.y * radiusVec.y * fudgedMass / 3;
    var mz = radiusVec.z * radiusVec.z * fudgedMass / 3;
    this.angMass.x = my + mz;
    this.angMass.y = mz + mx;
    this.angMass.z = mx + my;

    this.angMassInv.x = 1 / this.angMass.x;
    this.angMassInv.y = 1 / this.angMass.y;
    this.angMassInv.z = 1 / this.angMass.z;
  };

  exports.RigidBody.prototype.getLinearVel = function() {
    return this.linVel;
  };

  exports.RigidBody.prototype.addForce = function(frc) {
    this.accumForce.addSelf(frc);
  };

  exports.RigidBody.prototype.addLocForce = function(frc) {
    this.addForce(this.getLocToWorldVector(frc));
  };

  exports.RigidBody.prototype.addForceAtPoint = function(frc, pt) {
    this.accumForce.addSelf(frc);
    var ptOffset = new Vec3().sub(pt, this.pos);
    var torque = new Vec3().cross(ptOffset, frc);
    this.addTorque(torque);
  };

  exports.RigidBody.prototype.addLocForceAtPoint = function(frc, pt) {
    this.addForceAtPoint(this.getLocToWorldVector(frc), pt);
  };

  exports.RigidBody.prototype.addForceAtLocPoint = function(frc, pt) {
    this.addForceAtPoint(frc, this.getLocToWorldPoint(pt));
  };

  exports.RigidBody.prototype.addLocForceAtLocPoint = function(frc, pt) {
    this.addForceAtPoint(this.getLocToWorldVector(frc),
                          this.getLocToWorldPoint(pt));
  };

  exports.RigidBody.prototype.addTorque = function(trq) {
    this.accumTorque.addSelf(trq);
  };

  exports.RigidBody.prototype.addLocTorque = function(trq) {
    this.addTorque(this.getLocToWorldVector(trq));
  };

  exports.RigidBody.prototype.getLinearVelAtPoint = function(pt) {
    var ptOffset = pt.clone().subSelf(this.pos);
    //var angVel2 = this.getLocToWorldVector(this.angVel);
    var cross = tmpVec3b.cross(this.angVel, ptOffset);
    return cross.addSelf(this.linVel);
  };

  exports.RigidBody.prototype.tick = function(delta) {
    var angVel = this.angVel;

    // Linear components.
    var linAccel = tmpVec3a.copy(this.accumForce).divideScalar(this.mass);
    linAccel.addSelf(this.sim.gravity);

    this.linVel.addSelf(linAccel.multiplyScalar(delta));

    this.pos.addSelf(tmpVec3a.copy(this.linVel).multiplyScalar(delta));

    //this.accumTorque.x = 0;
    //this.accumTorque.y = 0;

    // Integrate angular momentum.
    this.angMom.addSelf(this.accumTorque.multiplyScalar(delta));

    // Calculate ang velocity from ang momentum.
    angVel.copy(this.angMom);
    this.oriMatInv.multiplyVector3(angVel);
    angVel.multiplySelf(this.angMassInv);
    this.oriMat.multiplyVector3(angVel);

    // Integrate orientation.
    var halfDelta = 0.5 * delta;
    var omega = new Quat(angVel.x * halfDelta,
                         angVel.y * halfDelta,
                         angVel.z * halfDelta, 0);
    var spin = tmpQuat.multiply(omega, this.ori);

    // TODO: Add an add method to Quaternion.
    this.ori.x += spin.x;
    this.ori.y += spin.y;
    this.ori.z += spin.z;
    this.ori.w += spin.w;
    //this.ori.normalize();
    this.updateMatrices();

    // Reset accumulators.
    this.accumForce.x = this.accumForce.y = this.accumForce.z = 0;
    this.accumTorque.x = this.accumTorque.y = this.accumTorque.z = 0;
  };

  return exports;
});
