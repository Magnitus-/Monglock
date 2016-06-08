const mongoDB = require('mongodb');
Promise = require('bluebird');

const monglock = require('../lib/index');

var db = null;

exports.main = {
    'setUp': function(callback) {
        mongoDB.MongoClient.connect("mongodb://mongodb:27017/test", {native_parser:true}, (err, database) => {
            db = database;
            const testCol = db.collection('test');
            testCol.remove({}).then(() => {
                callback();
            });
        });
    },
    'tearDown': function(callback) {
        const testCol = db.collection('test');
        testCol.remove({}).then(() => {
            db.close();
            callback();
        });
    },
    'basic_functionality': function(test) {
        test.expect(8);
        const testCol = db.collection('test');
        var writeLock = null;
        var timestamp = null;
        testCol.insertOne({'_id': 1}).then(() => {
            writeLock = monglock.writeLock({'collection': 'test', 'db': db, 'locktimeout': 1000});
            return writeLock.acquire({'_id': 1});
        }).then(() => {
            return testCol.findOne({'_id': 1}).then((value) => {
                timestamp = value.lock.timestamp;
                test.ok(value.lock && value.lock.active === true && value.lock.timestamp, "Confirming that initial acquisition works");
            });
        }).then(() => {
            return writeLock.acquire({'_id': 2}).catch((err) => {
                test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 404 && err.output.payload.message == 'RessourceNotFound', "Confirming that acquisition on non-existent ressource fails with the right error");
            });
        }).then(() => {
            return writeLock.acquire({'_id': 1}).catch((err) => {
                test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 && err.output.payload.message == 'LockAlreadyTaken', "Confirming that acquisition on ressource with pre-existing lock fails with the right error");
            });
        }).then(() => {
            return writeLock.release({'_id': 2}).catch((err) => {
                test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 404 && err.output.payload.message == 'RessourceNotFound', "Confirming that release on non-existent ressource fails with the right error");
            });
        }).then(() => {
            return writeLock.release({'_id': 1}).then(() => {
                return testCol.findOne({'_id': 1});
            }).then((value) => {
                test.ok(value.lock && value.lock.active === false, "Confirming that releasing a ressource works");
            });
        }).then(() => {
            return writeLock.acquire({'_id': 1}).then(() => {
                return testCol.findOne({'_id': 1});
            }).then((value) => {
                test.ok(value.lock && value.lock.active === true && value.lock.timestamp && value.lock.timestamp != timestamp, "Confirming that further acquisition works");
                timestamp = value.lock.timestamp;
            });
        }).then(() => {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    return writeLock.acquire({'_id': 1}).then(() => {
                        return testCol.findOne({'_id': 1});
                    }).then((value) => {
                        test.ok(value.lock && value.lock.active === true && value.lock.timestamp && value.lock.timestamp != timestamp, "Confirming that lock timeout works");
                        resolve();
                    }).catch((err) => {
                        reject(err);
                    });
                }, 1100);
            });
        }).then(() => {
            return writeLock.release({'_id': 1}, {'timestamp': timestamp}).catch((err) => {
                test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 && err.output.payload.message == 'LockWasReacquired', "Confirming that lock-reaquisiation after timeout is reported if timestamp is passed to release");
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });
    }
}
