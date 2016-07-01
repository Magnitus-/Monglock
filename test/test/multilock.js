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
    'cooperative_locks': function(test) {
        test.expect(3);
        var aLock = null;
        var bLock = null;
        var testCol = db.collection('test');
        testCol.insertOne({'_id': 1}).then(() => {
            var multiLock = monglock.multiLock({
                db: db,
                locktimeouts: {
                    a: 1000,
                    b: 1000
                },
                lockRelationships: {
                    a: {'cooperative': ['b']},
                    b: {'cooperative': ['a']}
                },
                collection: 'test',
                timeout: 1000,
                w: 1
            });
            return multiLock.acquire({'_id': 1}, {'tag': 'a'}).then((lock) => {
                aLock = lock;
            }).then(() => {
                return multiLock.acquire({'_id': 1}, {'tag': 'b'}).catch((err) => {
                    test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 && err.output.payload.message == 'CooperativeLock', "Ensuring cooperative locks prevent access.");
                });
            }).then(() => {
                return multiLock.release({'_id': 1}, {'lock': aLock, 'tag': 'a'}).then(() => {
                    return multiLock.acquire({'_id': 1}, {'tag': 'a'});
                }).then((lock) => {
                    aLock = lock;
                    test.ok(lock, "Ensure that acquiring a lock failed without holding the lock.");
                });
            }).then(() => {
                return multiLock.release({'_id': 1}, {'lock': aLock, 'tag': 'a'}).then(() => {
                    return multiLock.acquire({'_id': 1}, {'tag': 'b'});
                }).then((lock) => {
                    bLock = lock;
                    test.ok(lock, "Ensure that releasing a lock works.");
                }).then(() => {
                    return multiLock.release({'_id': 1}, {'lock': bLock, 'tag': 'b'});
                });
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });
        
    },
    'aggressive_locks': function(test) {
        test.expect(0);
        test.done();
    },
    'concurrent_locks': function(test) {
        test.expect(0);
        test.done();
    },
    'lock_timeouts': function(test) {
        test.expect(0);
        test.done();
    },
    'misuse': function(test) {
        test.expect(0);
        test.done();
    }
}
