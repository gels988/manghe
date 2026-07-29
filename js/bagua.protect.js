(() => {
    const BAGUA_TO_BITS = {
        "1": "111",
        "2": "011",
        "3": "101",
        "4": "001",
        "5": "110",
        "6": "010",
        "7": "100",
        "8": "000"
    };

    function decodeBaguaText(encoded, bitLength) {
        const digits = String(encoded || "").replace(/\s+/g, "");
        let bits = "";
        for (const ch of digits) {
            const tri = BAGUA_TO_BITS[ch];
            if (!tri) {
                throw new Error(`INVALID_BAGUA_DIGIT:${ch}`);
            }
            bits += tri;
        }
        bits = bits.slice(0, bitLength);

        const byteLength = Math.floor(bits.length / 8);
        const bytes = new Uint8Array(byteLength);
        for (let i = 0; i < byteLength; i++) {
            bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
        }
        return new TextDecoder("utf-8").decode(bytes);
    }

    function mountProtectedNodes() {
        const payloadNodes = document.querySelectorAll('script[type="application/x-bagua"]');
        payloadNodes.forEach((node) => {
            const targetId = node.getAttribute("data-bagua-target");
            const bitLength = parseInt(node.getAttribute("data-bagua-bits") || "0", 10);
            if (!targetId || !bitLength) {
                throw new Error("BAGUA_PAYLOAD_METADATA_MISSING");
            }

            const target = document.getElementById(targetId);
            if (!target) {
                throw new Error(`BAGUA_TARGET_NOT_FOUND:${targetId}`);
            }

            const html = decodeBaguaText(node.textContent || "", bitLength);
            target.insertAdjacentHTML("beforebegin", html);
            target.remove();
            node.remove();
        });
    }

    mountProtectedNodes();
})();
