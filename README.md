# Purpose

Mongodb locking library that operates on arbitrary documents in arbitrary collections.

It returns promises and optionally, it can wrap its errors with boom (as in the npm library).

Behavior when a lock cannot be acquired is to trigger an error and let the caller determine how to handle retrying.

## Note About Locks

As a rule of thumb, you should probably use locks as sparingly as possible and make locks as specific as possible to maximize concurrency in your application.

If possible, try to think about how you can structure your collection and data-access pattern to avoid conflict or if your use case allows for it and it rarely happens, allow conflicting access, detect that it has occured and recover gracefully from it.

As an extreme example, you could use this library to secure a lock on each collection before accessing it (if you create a lock collection containing documents representing various collections to acquire a lock on), but if you end up doing that, you'll kill all the paralellism in your application and you may as well use an SQL database like PostgreSQL and take advantage of its transaction capabilities.

## Side-Effect

Both the writeLock and multiLock operate on one document at a time and will create and manage 'lock' property in the database document it acquires a lock on.

You can use a projection during queries to hide this property from user-facing results (or do it elsewhere in your code).

## About usage with the boom library

Version 1 of the library always returned boom errors.

However, it quickly occured to me that I might want to use the library outside the context of hapi or even outside the context of a web server.

Add to this the changing versions of boom (which may or may not be coupled to particular versions of hapi) and the fact that recent versions of boom require node >= 8 (which seem gratuitous to me given the limited scope of what it does) and it became clear that this library had to be decoupled from boom and especially from a particular version of boom.

So, while, you can still wrap errors that are returned by this library with boom. In order to do so, you'll now need to require the boom module you are using and pass it to the locks' constructor.

The test environment for the library is with boom version 5 (lastest that was still at least compatible with node 6). However, I looked at the boom api for version 3, 5 and 7 and ensured that the calls that are done internally are the same across all those versions.

## writeLock

The write lock is useful when you only need one type of lock that you need to grab (ex: you want to prevent conflicting writes and there aren't any types of writes that can occur concurrently).

### Methods

#### Constructor

```
module.writeLock(<params>)
```

Returns a writeLock instance from which locks can be acquired and released.

'params' is an object with the following properties:

- locktimeout: How long (in milliseconds) a lock will be held before getting automatically released. Ideally, this value should be high enough to give operations plenty of time to complete and release the lock, but not so high that the database will require manual intervention if a process fails while holding the lock and fails to release it. Defaults to 10000 (10 seconds).
- collection: A mongodb collection instance containing documents to acquire a lock on.
- timeout: How long single database read/write operations from the library should wait before declaring failure. Defaults to 10000 (10 seconds).
- w: Replication parameter for write operations (1 to return after the master acknowledged the write, 'majority' to return after a majority of servers in the replica set acknowledges the write). Defaults to 'majority'.
- boom: An imported instance of the boom library to return boom wrapped errors. If omitted, regular errors will be returned instead.

#### acquire

```
writeLockInstance.acquire(<filter>, <params>)
```

Returns a promise that passes the lock's timestamp on success (to 'then' handler) or error on failure (to 'catch' handler).

'filter' is an object that uniquely identifies the document you want to obtain a lock on.

'params' take all the same properties as the constructor and allow you to override constructor properties at lock acquisition time.

Errors:

Foreseen errors that are directly handled by the method can take any of the following form:

```
//With boom:
err.output.payload.statusCode == 404 && err.output.payload.message == 'RessourceNotFound'

//Without boom:
err.type == 'notFound' && err.subtype == 'RessourceNotFound'
```

This means the document you tried to acquire a lock on doesn't exist

```
//With boom:
err.output.payload.statusCode == 409 && err.output.payload.message == 'LockAlreadyTaken'

//Without boom:
err.type == 'conflict' && err.subtype == 'LockAlreadyTaken'
```

This means the lock was already acquired and you'll have to wait for the lock to be freed

```
With boom:
err.output.payload.statusCode == 500 && err.output.payload.message == 'DbError'

Without boom:
err.type == badImplementation && err.subtype == 'DbError'
```

Some other database error, probably a timeout on a database operation.


#### release

```
writeLockInstance.release(<filter>, <params>)
```

'filter' is an object that uniquely identifies the document you want to release the lock on.

'params' take all the same properties as the constructor and allow you to override constructor properties at lock acquisition time. Additionally, it takes the 'timestamp' property which is the timestamp the lock was acquired on.

Returns a promise that passes nothing on success (to 'then' handler) or error on failure (to 'catch' handler).

Errors:

Foreseen errors that are directly handled by the method can take any of the following form:

```
//With boom:
err.output.payload.statusCode == 404, err.output.payload.message == 'RessourceNotFound'

//Without boom:
err.type == 'notFound' && err.subtype == 'RessourceNotFound'
```

This means the document you tried to release a lock on doesn't exist

```
//With boom:
err.output.payload.statusCode == 409, err.output.payload.message == 'LockWasReacquired'

//Without boom:
err.type == 'conflict' && err.subtype == 'LockWasReacquired'
```

This means the current lock timed out and the lock was required somewhere else

```
//With boom:
err.output.payload.statusCode == 500, err.output.payload.message == 'DbError'

//Without boom:
err.type == badImplementation && err.subtype == 'DbError'
```

Some other database error, probably a timeout on a database operation.

### Example

```
const mongoDB = require('mongodb');
Promise = require('bluebird');
const boom = require('boom');

const monglock = require('monglock');

var writeLock = null;

mongoDB.MongoClient.connect("mongodb://mongodb:27017", {native_parser:true}, (err, conn) => {
    const testCol = conn.db('test').collection('test');

    //Build writeLock instance
    writeLock = monglock.writeLock({'collection': testCol, 'locktimeout': 1000, 'boom': boom});

    //Build a document to acquire a lock on
    testCol.insertOne({'_id': 1}).then(() => {
        //Acquire lock
        return writeLock.acquire({'_id': 1}).then((timestamp) => {

            //We have a lock, do your operation

            //Once we are done, release the lock
            return writeLock.release({'_id': 1}).then(() => {
                //All done!
            }).catch(err) => {
                if(err.output.payload.message == 'LockWasReacquired')
                {
                    //Oops, the lock timed out while we were doing our operation
                }
                else if(err.output.payload.message == 'RessourceNotFound')
                {
                    //The document no longer exists, did we delete it?
                }
                else
                {
                    //Database error, probably a timeout
                }
            });

        }).catch((err) => {
            if(err.output.payload.message == 'LockAlreadyTaken')
            {
                //Lock was already taken, wait and try again
            }
            else if(err.output.payload.message == 'RessourceNotFound')
            {
                //Document doesn't exist, was it deleted elsewhere?
            }
            else
            {
                //Database error, probably a timeout
            }
        });
    });
});
```

## multiLock

The multi lock is useful when you have various types of locks (ex: read and write locks or two types of write locks, one for atomic writes and one for non-atomic writes) and you want to fine tune the locking behavior.

### Concepts

multiLock allows you to use various types of locks with different tag names and various relationships with locks having various tags.

- Concurrent locks: By default, locks are concurrent (will ignore each other) and will successfully acquire locks concurrently.

- Cooperative locks:  You can make locks with a given tag (let's call it tagA) 'cooperative' with locks of a given tag (let's call it tagB).

This means that attempts to acquire a lock with tagA will return a failure if a lock with tagB is held and tagA will not have acquired the lock.

Note that tagA and tagB can be the same tag.

- Assertive locks: You can make locks of a given tag (let's  call it tagA) 'assertive' with locks of a given tag (let's call it tagB).

This means that attempts to acquire a lock with tagA will return a failure if a lock with tagB is held, but the lock will still be acquired (meaning that locks that are 'cooperative' with tagA won't be acquired while tagA is waiting for locks it is assertive on to be freed).

Note: tagA and tagB should never be the same and two different tags should never be 'assertive' to each other as this will eventually (not if, when) lead to deadlocks. There are also circular deadlock possibilities if you don't carefully look at your flow to make 100% sure two locks won't end up waiting for each other. Deadlocks are evil and will generate the occasional sporadic bug that will be hard to track down. Beware of the deadlock.

### Methods

#### Constructor

```
module.multiLock(<params>)
```

Returns a multiLock instance from which locks can be acquired and released.

'params' is an object with the following properties:

- locktimeouts: How long (in milliseconds) locks with various tags will be held before getting automatically released. Ideally, this value should be high enough to give operations plenty of time to complete and release the lock, but not so high that the database will require manual intervention if a process fails while holding the lock and fails to release it.
- lockRelationships: Relationships of lock tags
- collection: A mongodb collection instance containing documents to acquire a lock on.
- timeout: How long single database read/write operations from the library should wait before declaring failure. Defaults to 10000 (10 seconds).
- w: Replication parameter for write operations (1 to return after the master acknowledged the write, 'majority' to return after a majority of servers in the replica set acknowledges the write). Defaults to 'majority'.
- boom: An imported instance of the boom library to return boom wrapped errors. If omitted, regular errors will be returned instead.

#### Acquire

```
multiLockInstance.acquire(<filter>, <params>)
```

Returns a promise that passes a lock on success (to 'then' handler) or error on failure (to 'catch' handler).

'filter' is an object that uniquely identifies the document you want to obtain a lock on.

'params' take all the properties of the constructor (allowing you to override them at acquire time) except for 'locktimeouts' and 'lockRelationships'. Additionally, either a 'tag' property (to specify the type of lock for a new lock) or a 'lock' property (to proceed with lock waiting on locks it is 'assertive' on to be freed) is required.

Errors:

Foreseen errors that are directly handled by the method can take any of the following form:

```
//With boom:
err.output.payload.statusCode == 404 && err.output.payload.message == 'RessourceNotFound'

//Without boom:
err.type == 'notFound' && err.subtype == 'RessourceNotFound'
```

This means the document you tried to acquire a lock on doesn't exist

```
//With boom:
err.output.payload.statusCode == 409 && err.output.payload.message == 'CooperativeLock'

//Without boom:
err.type == 'conflict' && err.subtype == 'CooperativeLock'
```

This means the document is held by at least one lock that the lock you are trying to acquire is 'cooperative' with.

```
//With boom:
err.output.payload.statusCode == 409 && err.output.payload.message == 'AssertiveLock', err.data == <your lock>

//Without boom:
err.type == 'conflict' && err.subtype == 'AssertiveLock' && err.lock == <your lock>
```

This means the document is held by at least one lock that the lock you are trying to acquire is 'assertive' with.

The lock was acquired, but you should make the acquire call again until all locks your lock is assertive on are freed.

```
//With boom:
err.output.payload.statusCode == 500 && err.output.payload.message == 'DbError'

//Without boom:
err.type == badImplementation && err.subtype == 'DbError'
```

Some other database error, probably a timeout on a database operation.

#### Release

```
multiLockInstance.release(<filter>, <params>)
```

'filter' is an object that uniquely identifies the document you want to release the lock on.

'params' take all the properties of the constructor (allowing you to override them at acquire time) except for 'locktimeouts' and 'lockRelationships'. Additionally, it takes a 'lock' property identifying the lock to release.

Returns a promise that passes nothing on success (to 'then' handler) or error on failure (to 'catch' handler).

Errors:

```
//With boom:
err.output.payload.statusCode == 404, err.output.payload.message == 'RessourceNotFound'

//Without boom:
err.type == 'notFound' && err.subtype == 'RessourceNotFound'
```

This means the document you tried to release a lock on doesn't exist

```
//With boom:
err.output.payload.statusCode == 409, err.output.payload.message == 'LockNotFound'

//Without boom:
err.type == 'conflict' && err.subtype == 'LockNotFound'
```

This means the lock you tried to release in the document did not exist


```
//With boom:
err.output.payload.statusCode == 500, err.output.payload.message == 'DbError'

//Without boom:
err.type == badImplementation && err.subtype == 'DbError'
```

Some other database error, probably a timeout on a database operation.

### Example

```
const mongoDB = require('mongodb');
Promise = require('bluebird');
const boom = require('boom');

const monglock = require('monglock');

var multiLock = null;
var lockInstance = null;

mongoDB.MongoClient.connect("mongodb://mongodb:27017", {native_parser:true}, (err, conn) => {
    const testCol = conn.db('test').collection('test');

    //Build multiLock instance
    //Here, we have a read/write multiLock, where reads are concurrent and cooperative with writes while writes are cooperative with each other and assertive with reads
    multiLock = monglock.multiLock({
        'collection': 'test',
        'locktimeout': 1000,
        'locktimeouts': {
            'read': 2000,
            'write': 20000
        },
        'lockRelationships': {
            'read': {
                'cooperative': ['write']
            },
            'write': {
                'cooperative: ['write'],
                'assertive': ['read']
            }
        },
        'collection': testCol,
        'timeout': 10000,
        'w': 'majority',
        'boom': boom
    });

    //Create a test document to acquire locks on
    testCol.insertOne({'_id': 1}).then(() => {
        return multiLock.acquire({'_id': 1}, {'tag': 'write'}).then((lock) => {
            lockInstance = lock;

            //We have the lock, do your write

            //Now, let's release the lock
            return multiLock.release({'_id': 1}, {'lock': lockInstance}).then(() => {
                //All done!
            }).catch((err) => {
                if(err.output.payload.message == 'RessourceNotFound')
                {
                    //Seems the document we are operating on got deleted
                }
                else if(err.output.payload.message == 'LockNotFound')
                {
                    //Not sure what happened there, but our lock is gone... probably a programming error
                }
                else
                {
                    //Db error, probably a timeout
                }
            });
        }).catch((err) => {
            if(err.output.payload.message == 'RessourceNotFound')
            {
                //document doesn't exist, maybe it got deleted elsewhere
            }
            else if(err.output.payload.message == 'CooperativeLock')
            {
                //Other write in progress, will have to wait
            }
            else if(err.output.payload.message == 'AssertiveLock')
            {
                //Read in progress, lock was acquired assertively, but will have to call acquire again to make sure all reads are finished
                //Don't forget to store the lock!
                lockInstance = err.output.payload.lock;
            }
            else
            {
                //Db error, probably a timeout
            }
        });
    });
});
```

### High Traffic Note

Multilock uses an array inside the lock object to store concurrent locks of a given tag.

If you expect huge concurrent lock traffic centered around a single database document where locks are not freed as quickly as they are acquired and accumulate, this could potentially lead to a very large array of locks (not the ideal structure for efficient management of MongoDB documents).

In addition to the above, this library is simply a locking library, it is not a queue manager (ie, no guaranteed ordering). so if, say, you have a huge volume of lock acquisitions of tagA locks and tagB is 'cooperative' to tagA, then you might starve tagB locks (ie, it will never acquire the lock). You might even starve some tagA locks if tagA is 'cooperative' with itself.
