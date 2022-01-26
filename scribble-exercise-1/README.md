# Scribble Exercise 1

## Setup

1. install the global package @truffle/db, which we will need to make extra build artifacts available to the fuzzer

`npm install -g @truffle/db`

2. add the following line to your truffle-config.js:

`db: { enabled: true }`

3. install ganache-cli globally

`npm install -g ganache-cli`

4. install truffle globally

`npm install -g truffle`

5. run ganache-cli in a separate tab

`ganache-cli --determinstic --allowUnlimitedContractSize`

6. Run the commands in the [Directions](#Directions) section

## Directions

```bash
fuzz -c .fuzz.yml arm
truffle compile
truffle exec scripts/seed.js
fuzz -c .fuzz.yml run
fuzz -c .fuzz.yml disarm
```