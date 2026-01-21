const readline = require('readline');

console.log("--- DEBUG START ---");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("Interface created. Starting question...");

rl.question('NÄKYVÄ TESTI: Kirjoita jotain ja paina Enter: ', (vastaus) => {
    console.log(`Hienoa! Kirjoitit: ${vastaus}`);
    rl.close();
    process.exit(0);
});
