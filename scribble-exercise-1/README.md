# Scribble Exercise 1

## Setup

1. install all following packages globally

`npm install -g @truffle/db ganache-cli truffle eth-scribble`

2. add the following line to your truffle-config.js:

`db: { enabled: true }`

3. run ganache-cli in a separate tab

`ganache-cli --determinstic --allowUnlimitedContractSize`

4. Run the commands in the [Directions](#Directions) section

## Directions

```bash
fuzz -c .fuzz.yml arm
truffle compile
truffle exec scripts/seed.js
fuzz -c .fuzz.yml run
fuzz -c .fuzz.yml disarm
```