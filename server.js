// servidor codigo.txt
const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
console.log("Servidor iniciado en puerto " + port);
require('events').EventEmitter.defaultMaxListeners = 100;

let nextId = 1;
const maps = new Map();
const personalMaps = new Map();
const playerMaps = new Map();
const publicMapNames = new Map();
const mapCreators = new Map();
const playerColors = new Map();

wss.on('connection', (ws) => {
    ws.id = nextId++;
    console.log(`Client ${ws.id} connected`);

    const personalMapId = `personal_${ws.id}`;
    personalMaps.set(personalMapId, []);
    playerMaps.set(ws.id, personalMapId);

    ws.send(JSON.stringify({
        type: 'id',
        id: ws.id
    }));

    ws.send(JSON.stringify({
        type: 'loadMap',
        blocks: [],
        mapId: personalMapId,
        canEdit: true
    }));

    const availableMaps = Array.from(publicMapNames.keys());
    console.log('Sending initial maps:', availableMaps);
    ws.send(JSON.stringify({
        type: 'mapsList',
        maps: availableMaps
    }));

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'playerCount',
                count: wss.clients.size
            }));
        }
    });

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'update':
                const currentMapId = playerMaps.get(ws.id);
                if (data.playerColor) {
                    playerColors.set(ws.id, data.playerColor);
                }
                wss.clients.forEach((client) => {
                    if (client !== ws &&
                        client.readyState === WebSocket.OPEN &&
                        playerMaps.get(client.id) === currentMapId) {
                        client.send(JSON.stringify({
                            type: 'update',
                            id: ws.id,
                            position: data.position,
                            rotation: data.rotation,
                            isGrounded: data.isGrounded,
                            animationTime: data.animationTime,
                            playerName: data.playerName,
                            playerColor: playerColors.get(ws.id)
                        }));
                    }
                });
                break;

            case 'blockUpdate':
                const targetMap = data.mapId.startsWith('personal_') ? personalMaps : maps;
                const isCreator = data.mapId.startsWith('personal_') || mapCreators.get(data.mapId) === ws.id;

                if (!isCreator) {
                    console.log(`Client ${ws.id} tried to edit map ${data.mapId} without permission`);
                    return;
                }

                let mapBlocks = targetMap.get(data.mapId) || [];

                if (data.action === 'add') {
                    const newBlock = {
                        ...data.block,
                        geometry: data.block.geometry || 'box',
                        isKiller: data.block.isKiller || false
                    };
                    mapBlocks.push(newBlock);
                } else if (data.action === 'remove') {
                    mapBlocks = mapBlocks.filter(block => block.id !== data.block.id);
                } else if (data.action === 'scale') {
                    const blockToUpdate = mapBlocks.find(block => block.id === data.block.id);
                    if (blockToUpdate) {
                        // Validar escalas (eficiencia: evitar valores extremos)
                        const newScale = data.block.scale;
                        if (newScale.x >= 0.1 && newScale.y >= 0.1 && newScale.z >= 0.1 &&
                            newScale.x <= 10 && newScale.y <= 10 && newScale.z <= 10) {
                            blockToUpdate.scale = newScale;
                            blockToUpdate.position = data.block.position;  // Mantiene posición (no cambia)
                        } else {
                            console.log(`Invalid scale for block ${data.block.id} in map ${data.mapId}`);
                            return;  // No aplica si inválido
                        }
                    }
                }
                targetMap.set(data.mapId, mapBlocks);

                wss.clients.forEach((client) => {
                    if (client !== ws &&
                        client.readyState === WebSocket.OPEN &&
                        playerMaps.get(client.id) === data.mapId) {
                        client.send(JSON.stringify({
                            type: 'blockUpdate',
                            action: data.action,
                            block: {
                                ...data.block,
                                geometry: data.block.geometry,
                                isKiller: data.block.isKiller
                            },
                            mapId: data.mapId
                        }));
                    }
                });
                break;

            case 'createMap':
                if (!data.mapId.startsWith('personal_')) {
                    const mapData = {
                        blocks: data.blocks.map(block => ({
                            ...block,
                            geometry: block.geometry || 'box',
                            scale: block.scale || { x: 1, y: 1, z: 1 },
                            isKiller: block.isKiller || false
                        })) || [],
                        creator: ws.id,
                        name: data.mapName
                    };

                    maps.set(data.mapId, mapData.blocks);
                    publicMapNames.set(data.mapName, data.mapId);
                    mapCreators.set(data.mapId, ws.id);
                    console.log(`Map created: ${data.mapName} by ${ws.id}`);

                    const updatedMaps = Array.from(publicMapNames.keys());
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'mapsList',
                                maps: updatedMaps
                            }));
                        }
                    });
                }
                break;

            case 'joinMap':
                const mapId = publicMapNames.get(data.mapId) || data.mapId;
                const mapToJoin = data.mapId.startsWith('personal_') ?
                    personalMaps.get(mapId) :
                    maps.get(mapId);

                if (mapToJoin !== undefined) {
                    playerMaps.set(ws.id, mapId);
                    const isMapCreator = mapCreators.get(mapId) === ws.id;

                    ws.send(JSON.stringify({
                        type: 'loadMap',
                        blocks: mapToJoin,
                        mapId: mapId,
                        canEdit: isMapCreator
                    }));
                }
                break;

            case 'requestMapsList':
                const currentMaps = Array.from(publicMapNames.keys());
                console.log('Sending maps list:', currentMaps);
                ws.send(JSON.stringify({
                    type: 'mapsList',
                    maps: currentMaps
                }));
                break;

            case 'chat':
                const senderMapId = playerMaps.get(ws.id);
                wss.clients.forEach((client) => {
                    if (client !== ws &&
                        client.readyState === WebSocket.OPEN &&
                        playerMaps.get(client.id) === senderMapId) {
                        client.send(JSON.stringify({
                            type: 'chat',
                            message: data.message,
                            sender: data.sender,
                            id: ws.id
                        }));
                    }
                });
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Client ${ws.id} disconnected`);

        personalMaps.delete(`personal_${ws.id}`);
        playerMaps.delete(ws.id);
        playerColors.delete(ws.id);

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'playerLeft',
                    id: ws.id
                }));
                client.send(JSON.stringify({
                    type: 'playerCount',
                    count: wss.clients.size
                }));
            }
        });
    });
});


console.log('WebSocket server started on port 8080');
