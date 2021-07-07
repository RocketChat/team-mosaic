const Crawler = require("crawler");
const got = require('got');
const sharp = require('sharp');
const cliProgress = require('cli-progress');

const canvasWidth = 1440;
const canvasHeight = 810;
const spacing = 4;
const background = 'transparent';
const imageSize = 200;
const outputImg = 'mosaic.png';

const resize = {
	width: imageSize,
	height: imageSize,
	fit: sharp.fit.cover,
	position: 'top',
};

async function getListOfImages() {
	console.log('Getting list of files...');
	return new Promise((resolve) => {
		const c = new Crawler({
			callback: function(error, res, done) {
				if (error) {
					return console.log({error})
				}

				const images = res.$('.img-profile')
				resolve(images.get().filter((i) => i.attribs && i.attribs.style).map((i) => i.attribs.style.replace('background-image: url(', '').replace(/\)$/, '')));
			}
		})

		c.queue('https://rocket.chat/team')
	});
}

async function downloadImgAndResize(images) {
	console.log('Downloading images...');
	const bar = new cliProgress.SingleBar({});
	bar.start(images.length, 0);

	const buffers = [];
	for await (const image of images) {
		try {
			const response = await got(image);
			buffers.push(await sharp(response.rawBody, {failOnError: false})
				.on('error', (e) => console.log(image, e))
				.resize(resize).toBuffer());
		} catch(e) {
			continue;
		} finally {
			bar.increment();
		}
	}
	bar.stop();
	return buffers;
}

async function generateMosaic(sources) {
	console.log('Generating mosaic...');

	sources.sort( () => .5 - Math.random() );

	const proportion = canvasWidth / canvasHeight;
	const width = Math.round(Math.pow(sources.length, 1/proportion));
	const height = Math.ceil(sources.length / width);
	const missing = width - sources.length % width;

	if (missing > 0) {
		const missingImg = await sharp('missing.jpg')
			.resize(resize).toBuffer();

		sources.push(...new Array(missing).fill(missingImg));
	}

	const imgSize = imageSize + spacing

	sharp({
		create: {
			width: width * imgSize + spacing,
			height: height * imgSize + spacing,
			channels: 4,
			background,
		}
	})
	.composite(sources.map((s, i) => {
		return {
			input: s,
			left: (i % width) * imgSize + spacing,
			top: Math.trunc(i/width) * imgSize + spacing,
		}
	}))
	.png()
	.pipe(sharp()
		.resize(canvasWidth, canvasHeight, {
			background,
			fit: 'contain',
		})
	)
	.toFile(outputImg);
}

getListOfImages()
	.then(downloadImgAndResize)
	.then(generateMosaic);
