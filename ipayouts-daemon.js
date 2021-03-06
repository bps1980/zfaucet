const rpc = require('./lib/rpc');
const ipayouts = require('./lib/ipayouts');
const config = require('./config');
const sending = require('./sending');

const findInput = sending.findInputs;

function buildSendList(payouts) {
	const sendMap = {};

	for (const {address, amount} of payouts) {
		if (!(address in sendMap))
			sendMap[address] = 0;

		sendMap[address] += amount;
	}

	const sendList = [];

	for (const address in sendMap) {
		if ({}.hasOwnProperty.call(sendMap, address)) {
			sendList.push({
				address,
				amount: sendMap[address].toFixed(8)
			});
		}
	}

	return sendList;
}

async function sendPayouts() {
	const inputAddress = await findInput();
	const payouts = await ipayouts.getUnpaid();
	const sendList = buildSendList(payouts);

	for (const send of sendList)
		send.amount -= config.sendingFee / sendList.length;

	const operationId = await rpc.zSendmany(
		inputAddress,
		sendList,
		1,
		config.sendingFee
	);

	await Promise.all(payouts.map(async payout => {
		payout.processed = Date.now();
		payout.operationId = operationId;

		await ipayouts.update(payout);
	}));
}

async function updatePayouts() {
	const operations = await rpc.zGetoperationresult();

	// update drips
	await Promise.all(operations.map(async transaction => {
		const results = await ipayouts.find(1000, {operationId: transaction.id});

		await Promise.all(results.map(async result => {
			result.transactionId = transaction.result.txid;

			await ipayouts.update(result);
		}));
	}));
}

module.exports = {
	findInput,
	buildSendList,
	sendPayouts,
	updatePayouts
};

/* istanbul ignore next */
if (require.main === module) {
	(async () => {
		async function job() {
			await sendPayouts();
			await updatePayouts();
		}

		const interval = 2.5 * 60 * 1000;

		for (;;) {
			const startTime = Date.now();

			await job();

			const delta = Date.now() - startTime;

			await new Promise(resolve => {
				setTimeout(resolve, Math.min(0, interval - delta));
			});
		}
	})();
}
