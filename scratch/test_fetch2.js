async function check() {
    try {
        const res = await fetch('http://127.0.0.1:8000/api/contracts');
        console.log(await res.text());
    } catch(e) { console.error(e); }
}
check();
