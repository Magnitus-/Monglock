const mongodb = require('mongodb');
Promise = require('bluebird');

const monglock = require('../lib/index');

exports.main = {
    'setUp': function(callback) {
        mongodb.MongoClient.connect('mongodb://database:27017', {native_parser:true})
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
                console.log(err);
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
    'cooperative_locks': function(test) {
        test.expect(3);
        var aLock = null;
        var bLock = null;
        const db = this.conn.db('test');
        const testCol = db.collection('test');
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
                return multiLock.release({'_id': 1}, {'lock': aLock}).then(() => {
                    return multiLock.acquire({'_id': 1}, {'tag': 'a'});
                }).then((lock) => {
                    aLock = lock;
                    test.ok(lock, "Ensure that acquiring a lock failed without holding the lock.");
                });
            }).then(() => {
                return multiLock.release({'_id': 1}, {'lock': aLock}).then(() => {
                    return multiLock.acquire({'_id': 1}, {'tag': 'b'});
                }).then((lock) => {
                    bLock = lock;
                    test.ok(lock, "Ensure that releasing a lock works.");
                }).then(() => {
                    return multiLock.release({'_id': 1}, {'lock': bLock});
                });
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });

    },
    'assertive_locks': function(test) {
        test.expect(4);
        var aLock = null;
        var bLock = null;
        const db = this.conn.db('test');
        const testCol = db.collection('test');
        testCol.insertOne({'_id': 1}).then(() => {
            var multiLock = monglock.multiLock({
                db: db,
                locktimeouts: {
                    a: 1000,
                    b: 1000
                },
                lockRelationships: {
                    a: {'cooperative': ['b']},
                    b: {'assertive': ['a']}
                },
                collection: 'test',
                timeout: 1000,
                w: 1
            });
            return multiLock.acquire({'_id': 1}, {'tag': 'a'}).then((lock) => {
                aLock = lock;
            }).then(() => {
                return multiLock.acquire({'_id': 1}, {'tag': 'b'}).catch((err) => {
                    bLock = err.output.payload.lock;
                    test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 &&
                            err.output.payload.message == 'AssertiveLock' && err.output.payload.lock, "Ensuring locks we are assertive on prevent access, but that the lock is still grabbed.");
                });
            }).then(() => {
                return multiLock.release({'_id': 1}, {'lock': aLock}).then(() => {
                    return multiLock.acquire({'_id': 1}, {'tag': 'a'}).catch((err) => {
                        test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 && err.output.payload.message == 'CooperativeLock', "Ensuring locks we are assertive on was grabbed.");
                    });
                }).then(() => {
                    return multiLock.acquire({'_id': 1}, {'lock': bLock}).then((lock) => {
                        test.ok(lock && lock.timestamp == bLock.timestamp && lock.id.equals(bLock.id), "Ensuring that second attemp to grab lock once lock we are assertive on is freed succeeds");
                    });
                }).then(() => {
                    return multiLock.release({'_id': 1}, {'lock': bLock}).then(() => {
                        return multiLock.acquire({'_id': 1}, {'tag': 'a'});
                    }).then((lock) => {
                        aLock = lock;
                        test.ok(lock, "Ensuring that the release of the assertive lock happened without problems");
                    }).then(() => {
                        return multiLock.acquire({'_id': 1}, {'lock': aLock});
                    });
                });
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });
    },
    'concurrent_locks': function(test) {
        test.expect(4);
        var aLock = null;
        var bLock = null;
        var cLock = null;
        const db = this.conn.db('test');
        const testCol = db.collection('test');
        testCol.insertOne({'_id': 1}).then(() => {
            var multiLock = monglock.multiLock({
                db: db,
                locktimeouts: {
                    a: 2000,
                    b: 2000,
                    c: 2000
                },
                lockRelationships: {
                    a: {'cooperative': ['c']},
                    b: {'cooperative': ['c']},
                    c: {'cooperative': ['a', 'b']}
                },
                collection: 'test',
                timeout: 1000,
                w: 1
            });
            return multiLock.acquire({'_id': 1}, {'tag': 'a'}).then((lock) => {
                aLock = lock;
                return multiLock.acquire({'_id': 1}, {'tag': 'b'});
            }).then((lock) => {
                test.ok(lock, "Confirming that two concurrent locks can be grabbed at the same time");
                bLock = lock;
                return multiLock.acquire({'_id': 1}, {'tag': 'c'}).catch((err) => {
                    test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 && err.output.payload.message == 'CooperativeLock', "Ensuring that concurrent locks still prevent access properly.");
                });
            }).then(() => {
                return multiLock.release({'_id': 1}, {'lock': aLock}).then(() => {
                    return multiLock.acquire({'_id': 1}, {'tag': 'c'}).catch((err) => {
                        test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 && err.output.payload.message == 'CooperativeLock', "Ensuring that concurrent locks prevent access properly when there is at least one lock remaining.");
                    });
                });
            }).then(() => {
                return multiLock.release({'_id': 1}, {'lock': bLock}).then(() => {
                    return multiLock.acquire({'_id': 1}, {'tag': 'c'}).then((lock) => {
                        cLock = lock;
                        test.ok(lock, "Confirming that releasing multiple concurrent locks work properly");
                    });
                });
            }).then(() => {
                return multiLock.release({'_id': 1}, {'lock': cLock})
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });
    },
    'lock_timeouts': function(test) {
        test.expect(3);
        var aLock = null;
        var bLock = null;
        var cLock = null;
        const db = this.conn.db('test');
        const testCol = db.collection('test');
        testCol.insertOne({'_id': 1}).then(() => {
            var multiLock = monglock.multiLock({
                db: db,
                locktimeouts: {
                    a: 100,
                    b: 400,
                    c: 1000,
                    d: 1000
                },
                lockRelationships: {
                    a: {},
                    b: {},
                    c: {},
                    d: {'cooperative': ['a','b','c']}
                },
                collection: 'test',
                timeout: 1000,
                w: 1
            });
            return Promise.all([multiLock.acquire({'_id': 1}, {'tag': 'a'}),
                                multiLock.acquire({'_id': 1}, {'tag': 'b'}),
                                multiLock.acquire({'_id': 1}, {'tag': 'c'})]).then((locks) => {
                aLock = locks[0];
                bLock = locks[1];
                cLock = locks[2];
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        multiLock.acquire({'_id': 1}, {'tag': 'd'}).then(() => {reject()}).catch((err) => {
                            test.ok(err, "Confirming that timeout is respected for all locks");
                            setTimeout(() => {
                                multiLock.acquire({'_id': 1}, {'tag': 'd'}).then(() => {reject()}).catch((err) => {
                                    test.ok(err, "Confirming that timeout is respected for all locks");
                                    setTimeout(() => {
                                        multiLock.acquire({'_id': 1}, {'tag': 'd'}).then((lock) => {
                                            test.ok(lock, "Confirming that locks timeout");
                                            resolve();
                                        });
                                    }, 690);
                                });
                            }, 300);
                        });
                    }, 110);
                });
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });
    },
    'misuse': function(test) {
        test.expect(2);
        const db = this.conn.db('test');
        const testCol = db.collection('test');
        var multiLock = monglock.multiLock({
            db: db,
            locktimeouts: {
                a: 100,
            },
            lockRelationships: {
                a: {'cooperative': ['a']}
            },
            collection: 'test',
            timeout: 1000,
            w: 1
        });
        multiLock.acquire({'_id': 1}, {'tag': 'a'}).catch((err) => {
            test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 404 && err.output.payload.message == 'RessourceNotFound', "Ensuring that lock on non-existent ressource fails with the right error.");
        }).then(() => {
            return testCol.insertOne({'_id': 1}).then(() => {
                return multiLock.release({'_id': 1}, {'lock': {'timestamp': 12334324324, 'id': 'lalalala', 'tag': 'a'}}).catch((err) => {
                    test.ok(err && err.output && err.output.payload && err.output.payload.statusCode == 409 && err.output.payload.message == 'LockNotFound', "Ensuring that releasing a non-existent lock fails with the right error.");
                });
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });
    }
}
