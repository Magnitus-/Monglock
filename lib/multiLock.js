const mongodb = require('mongodb');
const boom = require('boom');
const clone = require('clone');
Promise = require('bluebird');

//cooperative, assertive
function multiLock(params)
{
    if(this instanceof multiLock)
    {
        ['db', 'locktimeouts', 'lockRelationships', 'collection', 'timeout', 'w'].forEach((property) => {
            if(params[property])
            {
                this[property] = params[property];
            }
        });
    }
    else
    {
        return new writeLock(multiLock);
    }
}

multiLock.prototype.collection = 'lock';
multiLock.prototype.timeout = 10000;
multiLock.prototype.w = 'majority';

multiLock.prototype.acquire = function(filter, params) 
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['db', 'locktimeouts', 'lockRelationships', 'collection', 'timeout', 'w', 'tag', 'lock'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });
        

        var collection = params.db.collection(params.collection);
        var augmentedFilter = clone(filter);
        
        var or = null;
        if(params.lock)
        {    //Lock already acquired, make sure locks we are assertive on are free
             if(params.lockRelationships[params.tag].assertive && params.lockRelationships[params.tag].assertive.length > 0)
             {
                 or = [{'lock': {'$exists': false}}, {'$and': []}];
                 var now = params.lock ? params.lock.timestamp : Date.now();
                 var id = params.lock ? params.lock.id : new mongodb.ObjectID();
                 params.lockRelationships[params.tag].assertive.forEach((tag) => {
                     or['$and'].push({'$or'[{'lock.'+tag: {'$lte': now - params.locktimeouts[tag]}}, {'lock.'+tag: {'$exists': false}}]);
                 });
             }
        }
        else
        {    //Lock not acquired, make sure locks we are cooperative on are free
             if(params.lockRelationships[params.tag].cooperative && params.lockRelationships[params.tag].cooperative.length > 0)
             {
                 or = [{'lock': {'$exists': false}}, {'$and': []}];
                 var now = params.lock ? params.lock.timestamp : Date.now();
                 var id = params.lock ? params.lock.id : new mongodb.ObjectID();
                 params.lockRelationships[params.tag].cooperative.forEach((tag) => {
                     or['$and'].push({'$or'[{'lock.'+tag: {'$lte': now - params.locktimeouts[tag]}}, {'lock.'+tag: {'$exists': false}}]);
                 });
             }
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
        
        if(!params.lock)
        {    //Lock already acquired so no update, a simple find to ensure locks we are assertive on are free will suffice
            
        }
        else
        {    //acquire lock while checking against lock we are cooperative on, then check on locks we are assertive on
            
        }
    });
}

multiLock.prototype.release = function(filter, params) 
{
}

module.exports = multiLock;