const mongodb = require('mongodb');
const clone = require('clone');
Promise = require('bluebird');

const utils = require('./utils');

//cooperative, assertive
function multiLock(params)
{
    if(this instanceof multiLock)
    {
        ['locktimeouts', 'lockRelationships', 'collection', 'timeout', 'w', 'boom'].forEach((property) => {
            if(params[property])
            {
                this[property] = params[property];
            }
        });
    }
    else
    {
        return new multiLock(params);
    }
}

multiLock.prototype.timeout = 10000;
multiLock.prototype.w = 'majority';

function augmentFilter(filter, params, lockType)
{
    var augmentedFilter = clone(filter);
    var or = null;

    if(params.lockRelationships[params.tag][lockType] && params.lockRelationships[params.tag][lockType].length > 0)
    {
        or = [{'lock': {'$exists': false}}, {'$and': []}];
        var now = params.lock ? params.lock.timestamp : Date.now();
        var toPush = null;
        params.lockRelationships[params.tag][lockType].forEach((tag) => {
            //would negation of "or" be better (faster/more legible)?
            toPush = {'$or': [{}, {}, {}]};
            toPush['$or'][0]['lock.'+tag+'.timestamp'] = {'$lte': now - params.locktimeouts[tag]};
            toPush['$or'][1]['lock.'+tag] = {'$size': 0};
            toPush['$or'][2]['lock.'+tag] = {'$exists': false};
            or[1]['$and'].push(toPush);
        });
    }

    if(or)
    {
        if(!augmentedFilter['$or'])
        {
            augmentedFilter['$or'] = or;
        }
        else
        {
            if(!augmentedFilter['$and'])
            {
                augmentedFilter['$and'] = [];
            }
            augmentedFilter['$and'].push(augmentedFilter['$or']);
            delete augmentedFilter['$or'];
            augmentedFilter['$and'].push({'$or': or});
        }
    }

    return augmentedFilter;
}

multiLock.prototype.acquire = function(filter, params)
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['locktimeouts', 'lockRelationships', 'collection', 'timeout', 'w', 'tag', 'lock', 'boom'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });

        if(params.lock)
        {
            params.tag = params.lock.tag;
        }

        var collection = params.collection;
        var augmentedFilter = null;

        var or = null;
        if(params.lock)
        {   //Lock already acquired, make sure locks we are assertive on are free
            augmentedFilter = augmentFilter(filter, params, 'assertive');
        }
        else
        {    //Lock not acquired, make sure locks we are cooperative on are free
            augmentedFilter = augmentFilter(filter, params, 'cooperative');
        }

        if(params.lock)
        {   //Lock already acquired so no update, a simple find to ensure locks we are assertive on are free will suffice
            collection.find(augmentedFilter).maxTimeMS(params.timeout).limit(1).toArray().then((value) => {
                value = value[0];
                if(value)
                {
                    resolve({'timestamp': params.lock.timestamp, 'id': params.lock.id, 'tag': params.lock.tag});
                }
                else
                {
                    reject(utils.getError(
                        'conflict',
                        'AssertiveLock',
                        params.boom,
                        {'timestamp': params.lock.timestamp, 'id': params.lock.id, 'tag': params.lock.tag}
                    ));
                }
            }).catch((err) => {
                reject(utils.getError('badImplementation', 'DbError', params.boom));
            });
        }
        else
        {    //acquire lock while checking against lock we are cooperative on, then check on locks we are assertive on
            var now = Date.now();
            var id = new mongodb.ObjectID();
            var update = {'$push': {}};
            update['$push']['lock.'+params.tag] = {'timestamp': now, 'id': id};
            collection.updateOne(augmentedFilter, update, {'w': params.w, 'wtimeout': params.timeout}).then((result) => {
                if(result.matchedCount == 1)
                {
                    augmentedFilter = augmentFilter(filter, params, 'assertive');
                    collection.find(augmentedFilter).maxTimeMS(params.timeout).limit(1).toArray().then((value) => {
                        value = value[0];
                        if(value)
                        {
                            resolve({'timestamp': now, 'id': id, 'tag': params.tag});
                        }
                        else
                        {
                            reject(utils.getError(
                                'conflict',
                                'AssertiveLock',
                                params.boom,
                                {'timestamp': now, 'id': id, 'tag': params.tag}
                            ));
                        }
                    });
                }
                else
                {
                    collection.find(filter).maxTimeMS(params.timeout).limit(1).toArray().then((value) => {
                        value = value[0];
                        if(value)
                        {
                            reject(utils.getError('conflict', 'CooperativeLock', params.boom));
                        }
                        else
                        {
                            reject(utils.getError('notFound', 'RessourceNotFound', params.boom));
                        }
                    }).catch((err) => {
                        throw err;
                    });
                }
            }).catch((err) => {
                reject(utils.getError('badImplementation', 'DbError', params.boom));
            });
        }
    });
}

multiLock.prototype.release = function(filter, params)
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['lock', 'collection', 'timeout', 'w', 'tag', 'boom'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });
        params.tag = params.lock.tag;

        var collection = params.collection;
        var augmentedFilter = clone(filter);
        augmentedFilter['lock.'+params.tag+'.id'] = params.lock.id;
        var update = {'$pull': {}};
        update['$pull']['lock.'+params.tag] = {'id': params.lock.id};
        collection.updateOne(augmentedFilter, update, {'w': params.w, 'wtimeout': params.timeout}).then((result) => {
            if(result.matchedCount == 1)
            {
                resolve();
            }
            else
            {
                collection.find(filter).maxTimeMS(params.timeout).limit(1).toArray().then((value) => {
                    value = value[0];
                    if(value)
                    {
                        reject(utils.getError('conflict', 'LockNotFound', params.boom));
                    }
                    else
                    {
                        reject(utils.getError('notFound', 'RessourceNotFound', params.boom));
                    }
                }).catch((err) => {
                    throw err;
                });
            }
        }).catch((err) => {
            reject(utils.getError('badImplementation', 'DbError', params.boom));
        });
    });
}

module.exports = multiLock;
