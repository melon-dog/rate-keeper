# rate-keeper

[![npm version](https://img.shields.io/npm/v/rate-keeper)](https://www.npmjs.com/package/rate-keeper) [![npm downloads](https://img.shields.io/npm/dm/rate-keeper)](https://www.npmjs.com/package/rate-keeper) [![License](https://img.shields.io/npm/l/rate-keeper)](https://www.npmjs.com/package/rate-keeper)

[![dependency count](https://badgen.net/bundlephobia/dependency-count/rate-keeper)](https://bundlephobia.com/package/rate-keeper) [![min zip](https://badgen.net/bundlephobia/minzip/rate-keeper)](https://bundlephobia.com/package/rate-keeper)

`rate-keeper` is a lightweight utility for easily adding rate limiting to functions and preventing API rate limit violations.

## Features

-   Create `actions` with rate limits.
-   Manages multiple queues by ID, allowing `sequential and parallel actions`.
-   Helps `prevent overloading` of external services by managing API usage.
-   Very `easy to integrate` into existing code.a

## Installation

Install the package via npm:

```bash
npm install rate-keeper
```

## Usage

Existing code.

```javascript
function logMessage(newLog) {
    console.log(newLog);
    return newLog;
}
```

### Basic

```javascript
import RateKeeper from "rate-keeper";

const safeLogger = RateKeeper(logMessage, 500); // Minimum of 500ms between calls.

safeLogger("Message 1");
safeLogger("Message 2");
safeLogger("Message 3");
```

```javascript
Message 1
//500ms later...
Message 2
//500ms later...
Message 3
```

### Queues

```javascript
import RateKeeper from "rate-keeper";

const queueID = 1001;

const logger1 = RateKeeper(logMessage, 500, { id: queueID }); // Shared queue with logger2
const logger2 = RateKeeper(logMessage, 500, { id: queueID }); // Shared queue with logger1
const logger3 = RateKeeper(logMessage, 500); // Independent queue

logger1("Queue Message 1");
logger2("Queue Message 2");
logger3("Independent Message");
```

```javascript
Queue Message 1
Independent Message
// 500ms later...
Queue Message 2
```

### Queues with Options

You can configure queues with custom settings, such as a maximum queue size and policies for handling overflow. Options include `Reject` (discard new entries when full) or `DropOldest` (remove the oldest entry to make room for new ones).

```javascript
import RateKeeper, { DropPolicy } from "rate-keeper";

const queueID = 2002;

const loggerWithLimit = RateKeeper(logMessage, 500, {
    id: queueID,
    maxQueueSize: 2,
    dropPolicy: DropPolicy.DropOldest, // Removes the oldest task when the queue is full
});

loggerWithLimit("Message 0"); // Processed.
loggerWithLimit("Message 1"); // Added to queue
loggerWithLimit("Message 2"); // Added to queue
loggerWithLimit("Message 3"); // "Message 1" is dropped, "Message 3" added

// Logs will be processed with a 500ms interval
```

```javascript
Message 0
// 500ms later...
Message 2
// 500ms later...
Message 3
```

### Promises

A function created with `rate-keeper` returns a promise containing the invocation result, making asynchronous handling straightforward.

```javascript
import RateKeeper from "rate-keeper";

const safeLogger = RateKeeper(logMessage, 500); // Minimum of 500ms between calls.

safeLogger("Hello World 1").then((result) => {
    //...
});
```

### Cancelable Actions

You can cancel an action that has not yet been executed.

```javascript
import RateKeeper from "rate-keeper";

const safeLogger = RateKeeper(logMessage, 500); // Minimum of 500ms between calls.

safeLogger("Message 1");
const message2 = safeLogger("Message 2");
safeLogger("Message 3");

message2.cancel();
```

```javascript
Message 1
//500ms later...
Message 3
```
