const mongodb = require('mongodb');
Promise = require('bluebird');
const boom = require('boom');

const monglock = require('../lib/index');

exports.main = {
    'setUp': function(callback) {
        mongodb.MongoClient.connect('mongodb://database:27017')
            .then((conn) => {
                this.conn = conn;
                return conn.db('test').collection('test');
            })
            .then((testCol) => {
                return testCol.remove({});
            })
            .then(() => {
                callback();
            })
            .catch((err) => {
                throw err;
            })
    },
    'tearDown': function(callback) {
        const testCol = this.conn.db('test').collection('test');
        testCol.drop()
            .then(() => {
                this.conn.close(true);
            })
            .then(() => {
                callback();
            })
            .catch((err) => {
                console.log(err);
                throw err;
            })
    },
    'basic_functionality': function(test) {
        test.expect(8);
        const testCol = this.conn.db('test').collection('test');
        var writeLock = null;
        var timestamp = null;
        testCol.insertOne({'_id': 1}).then(() => {
            writeLock = monglock.writeLock({'collection': testCol, 'locktimeout': 1000, 'boom': boom});
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
