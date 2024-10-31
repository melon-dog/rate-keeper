# rate-keeper

[![npm version](https://img.shields.io/npm/v/rate-keeper)](https://www.npmjs.com/package/rate-keeper) [![npm downloads](https://img.shields.io/npm/dm/rate-keeper)](https://www.npmjs.com/package/rate-keeper) ![License](https://img.shields.io/npm/l/rate-keeper)

`rate-keeper` is a lightweight utility for easily adding rate limiting to functions and preventing API rate limit violations.

## Features

- Create `actions` with rate limits.
- Manages multiple queues by ID, allowing `sequential and parallel actions`.
- Helps `prevent overloading` of external services by managing API usage.
- Very `easy to integrate` into existing code.
  
## Installation

Install the package via npm:

```bash
npm install rate-keeper
```

## Usage
Existing code.
```javascript
function UnsafeLogger(newLog) {
  console.log(newLog);
  return newLog;
}
```
### Basic
```javascript
const SafeLogger = RateKeeper(UnsafeLogger, 500); // Minimum of 500ms between calls.

SafeLogger("Hello World 1");
SafeLogger("Hello World 2");
SafeLogger("Hello World 3");
```
```javascript
Hello World 1
//500ms later...
Hello World 2
//500ms later...
Hello World 3
```
### Queues
```javascript
const customQueueID = 5721;

const SafeLogger1 = RateKeeper(UnsafeLogger, 500, customQueueID); // Same queue as Logger2.
const SafeLogger2 = RateKeeper(UnsafeLogger, 500, customQueueID); // Same queue as Logger1.
const SafeLogger3 = RateKeeper(UnsafeLogger, 500); // Own queue.

SafeLogger1("Hello World 1");
SafeLogger2("Hello World 2");
SafeLogger3("Hello World 3");
```
```javascript
Hello World 1
Hello World 3
//500ms later...
Hello World 2
```

### Promises
A function created with `rate-keeper` returns a promise containing the invocation result, making asynchronous handling straightforward.
```javascript
const SafeLogger = RateKeeper(UnsafeLogger, 500); // Minimum of 500ms between calls.

SafeLogger("Hello World 1").then(result => {
  //...
});
```
