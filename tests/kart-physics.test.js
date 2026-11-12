/*
 * Testes mínimos (Node, sem dependências) das correções de:
 *  1. resolveWallContact — deslize na mureta independente da orientação
 *  2. processLapGate     — uma volta por cruzamento, sem contagem dupla
 *
 * Extrai as funções diretamente de mario-kart.html e roda com um stub
 * mínimo de THREE.Vector3, sem alterar a interface do jogo.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

// ---------- stub mínimo de THREE.Vector3 ----------
function V3(x, y, z){ this.x = x || 0; this.y = y || 0; this.z = z || 0; }
V3.prototype.clone = function(){ return new V3(this.x, this.y, this.z); };
V3.prototype.copy = function(v){ this.x = v.x; this.y = v.y; this.z = v.z; return this; };
V3.prototype.add = function(v){ this.x += v.x; this.y += v.y; this.z += v.z; return this; };
V3.prototype.sub = function(v){ this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; };
V3.prototype.multiplyScalar = function(s){ this.x *= s; this.y *= s; this.z *= s; return this; };
V3.prototype.addScaledVector = function(v, s){ this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; };
V3.prototype.dot = function(v){ return this.x * v.x + this.y * v.y + this.z * v.z; };
V3.prototype.length = function(){ return Math.sqrt(this.dot(this)); };
V3.prototype.normalize = function(){
  var l = this.length() || 1;
  this.x /= l; this.y /= l; this.z /= l;
  return this;
};
V3.prototype.projectOnVector = function(v){
  var denom = v.dot(v) || 1;
  var s = this.dot(v) / denom;
  return v.clone().multiplyScalar(s);
};

// ---------- extrai funções do HTML ----------
var htmlPath = path.join(__dirname, '..', 'mario-kart.html');
var html = fs.readFileSync(htmlPath, 'utf8');

function extract(name){
  var start = html.indexOf('function ' + name + '(');
  if(start < 0) throw new Error('Função não encontrada: ' + name);
  var brace = html.indexOf('{', start);
  var depth = 0, i = brace;
  for(; i < html.length; i++){
    if(html[i] === '{') depth++;
    else if(html[i] === '}'){ depth--; if(depth === 0){ i++; break; } }
  }
  return html.slice(start, i);
}

var sandbox = {
  THREE: { Vector3: V3 },
  Math: Math, console: console,
  TAU: Math.PI * 2, LAPS: 3, START_ZONE_U: 0.1,
  raceTime: 5000, frame: 16,
  sndCrash: function(){ sandbox._crash = (sandbox._crash || 0) + 1; },
  onPlayerFinish: function(){ sandbox._finished = true; }
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(extract('resolveWallContact') + '\n' + extract('processLapGate'), sandbox);

// ---------- mini framework de asserção ----------
var passed = 0, failed = 0;
function ok(cond, msg){
  if(cond){ passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ FALHOU: ' + msg); }
}
function approx(a, b, eps){ return Math.abs(a - b) <= (eps || 1e-9); }

console.log('== resolveWallContact: deslize na mureta ==');

// Cenário A: nariz apontando PARA FORA da pista (o caso que prendia antes),
// com componente tangencial (45° contra a mureta), como numa colisão real
(function(){
  var trackPt = new V3(0, 0, 0);
  var trackTan = new V3(1, 0, 0);           // pista segue +X
  var maxSafe = 14.5;
  var heading = new V3(1, 0, 1).normalize(); // 45° para fora da pista
  var nextPos = new V3(0, 0, 18);           // atravessou a mureta
  var startAngle = Math.PI / 4;
  var kart = { speed: 1.0, angle: startAngle, isPlayer: false };
  var wallNormal = nextPos.clone().sub(trackPt).normalize();

  sandbox.resolveWallContact(kart, nextPos, heading, trackPt, wallNormal, trackTan, maxSafe);

  // Puxado de volta ao raio seguro, sem continuar fora da pista (pequeno
  // excesso residual vem do deslize tangencial e é corrigido no próximo frame)
  var radial = Math.hypot(nextPos.x, nextPos.z);
  ok(radial <= maxSafe + 1.0, 'A: reposicionado na borda segura (raio=' + radial.toFixed(3) + ')');
  // Componente tangencial preservado: houve deslize ao longo da parede (eixo X)
  ok(nextPos.x > 0.001, 'A: manteve deslize tangencial (x=' + nextPos.x.toFixed(3) + ')');
  // Velocidade NÃO foi zerada
  ok(Math.abs(kart.speed) > 0.9, 'A: velocidade não zerada (speed=' + kart.speed.toFixed(3) + ')');
  ok(approx(kart.speed, 1.0 * 0.992), 'A: aplicada a redução leve 0.992');
  // Tangente +X corresponde a angle=atan2(1,0)=pi/2 na convenção do jogo:
  // o ângulo deve caminhar de pi/4 na direção de pi/2
  var targetA = Math.atan2(trackTan.x, trackTan.z);
  ok(Math.abs(kart.angle - targetA) < Math.abs(startAngle - targetA),
    'A: ângulo alinhado à tangente (angle=' + kart.angle.toFixed(3) + ', alvo=' + targetA.toFixed(3) + ')');
})();

// Cenário B: nariz apontando para dentro (dotNormal < 0), correção mesmo assim
(function(){
  var trackPt = new V3(0, 0, 0);
  var trackTan = new V3(1, 0, 0);
  var maxSafe = 14.5;
  var heading = new V3(1, 0, -1).normalize(); // nariz para dentro, com componente tangencial
  var nextPos = new V3(0, 0, 18);
  var kart = { speed: 1.0, angle: -Math.PI / 4, isPlayer: false };
  var wallNormal = nextPos.clone().sub(trackPt).normalize();

  sandbox.resolveWallContact(kart, nextPos, heading, trackPt, wallNormal, trackTan, maxSafe);

  var radial = Math.hypot(nextPos.x, nextPos.z);
  ok(radial <= maxSafe + 1.0, 'B: também corrigido com nariz para dentro (raio=' + radial.toFixed(3) + ')');
  ok(nextPos.x > 0.001, 'B: deslizou tangencialmente mesmo com dotNormal<0');
  ok(Math.abs(kart.speed) > 0.9, 'B: velocidade preservada');
})();

// Cenário C: jogador real — som de colisão no ritmo de frames (frame % 16)
(function(){
  var trackPt = new V3(0, 0, 0);
  var trackTan = new V3(1, 0, 0);
  var heading = new V3(1, 0, 1).normalize();
  var nextPos = new V3(0, 0, 18);
  var kart = { speed: 1.0, angle: Math.PI / 4, isPlayer: true };
  var wallNormal = nextPos.clone().sub(trackPt).normalize();
  sandbox._crash = 0;
  sandbox.resolveWallContact(kart, nextPos, heading, trackPt, wallNormal, trackTan, 14.5);
  ok(sandbox._crash === 1, 'C: som de colisão tocado no frame 16 para o jogador');
})();

console.log('== processLapGate: contagem de voltas ==');

function mkKart(){
  return { lap: 1, lapGateArmed: false, finished: false, fTime: 0, isPlayer: false };
}

// 1. Ao sair da zona da partida, o gate é armado (sem contar volta)
(function(){
  var k = mkKart();
  sandbox.processLapGate(k, 0.5, 0.05);
  ok(k.lapGateArmed === true && k.lap === 1, '1: sair da zona arma o gate sem contar volta');
})();

// 2. Cruzamento real (prev>0.9 -> zona inicial) conta exatamente uma volta
(function(){
  var k = mkKart();
  sandbox.processLapGate(k, 0.5, 0.05); // arma
  sandbox.processLapGate(k, 0.05, 0.95); // cruza
  ok(k.lap === 2 && k.lapGateArmed === false, '2: cruzamento conta uma volta e desarma o gate');
})();

// 3. Tremor na linha: idas e vindas NÃO voltam a contar
(function(){
  var k = mkKart();
  sandbox.processLapGate(k, 0.5, 0.05); // arma
  sandbox.processLapGate(k, 0.05, 0.95); // conta (volta 2)
  for(var u = 0; u < 8; u++){
    sandbox.processLapGate(k, 0.03, 0.08);
    sandbox.processLapGate(k, 0.08, 0.03);
  }
  ok(k.lap === 2, '3: tremor na zona da partida não multiplica voltas (lap=' + k.lap + ')');
})();

// 4. Sem ter saído da zona, nunca conta
(function(){
  var k = mkKart(); // gate desarmado de fábrica
  sandbox.processLapGate(k, 0.05, 0.95);
  sandbox.processLapGate(k, 0.02, 0.05);
  ok(k.lap === 1, '4: sem deixar a zona, nenhuma volta é contada');
})();

// 5. Sentido contrário (prevU baixo) não conta
(function(){
  var k = mkKart();
  sandbox.processLapGate(k, 0.5, 0.2);
  sandbox.processLapGate(k, 0.05, 0.15); // veio de 0.15, não de >0.9
  ok(k.lap === 1, '5: cruzamento em sentido incorreto não conta volta');
})();

// 6. Três voltas completas: termina em lap=LAPS+1, finished=true, sem acumular além
(function(){
  var k = mkKart();
  for(var lap = 0; lap < 3; lap++){
    sandbox.processLapGate(k, 0.5, 0.05);
    sandbox.processLapGate(k, 0.05, 0.95);
  }
  ok(k.lap === 4 && k.finished === true, '6: após 3 voltas, finished=true e lap=4 (HUD faz clamp para 3)');
  // Mesmo continuando a rodar, não acumula mais nada
  sandbox.processLapGate(k, 0.5, 0.05);
  sandbox.processLapGate(k, 0.05, 0.95);
  sandbox.processLapGate(k, 0.5, 0.05);
  sandbox.processLapGate(k, 0.05, 0.95);
  ok(k.lap === 4, '6b: depois de LAPS não há mais acúmulo de voltas');
})();

// 7. Jogador termina: onPlayerFinish é chamado uma única vez
(function(){
  var k = mkKart(); k.isPlayer = true;
  sandbox._finished = false;
  for(var lap = 0; lap < 3; lap++){
    sandbox.processLapGate(k, 0.5, 0.05);
    sandbox.processLapGate(k, 0.05, 0.95);
  }
  ok(sandbox._finished === true && k.fTime === sandbox.raceTime, '7: jogador finaliza com tempo de corrida gravado');
})();

console.log('\n' + passed + ' testes OK, ' + failed + ' falhas');
process.exit(failed ? 1 : 0);
