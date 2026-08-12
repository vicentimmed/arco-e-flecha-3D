/* ---------------------------------------------------------------------------
   Física do jogador: character controller Rapier + pulo vertical.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";

/* Raio reaproveitado pelo teste de beira (`temChao`). Ele roda até três vezes
   por quadro; alocar um `Ray` a cada chamada seria lixo para o coletor recolher
   no caminho mais quente que existe — o do movimento.
   PREGUIÇOSO de propósito: `RAPIER` só existe depois de `initPhysics()`, e um
   `new RAPIER.Ray` no topo do módulo roda no import, antes disso. */
let _ray = null;

export class PlayerPhysics {
  constructor(physics, player, entityId) {
    this.physics = physics;
    this.player = player;
    this.entityId = entityId;

    this.desiredHorizontal = new THREE.Vector3();
    this._corrected = new THREE.Vector3();
    /** Velocidade horizontal REAL durante o voo de jetpack. Ver `step`. */
    this.jetVelocity = new THREE.Vector3();
    /** @type {import("./jetpack.js").Jetpack|null} só nas fases que têm um. */
    this.jetpack = null;

    /**
     * O corpo se recusa a ANDAR para dentro de uma queda mortal?
     *
     * Desligado por padrão, e ligado só por quem tem dano de queda — hoje, o
     * cerco (`Game.applySiegeMode`). É a mesma disciplina do jetpack logo
     * acima: o equipamento é da FASE, e o caminho do movimento não pergunta em
     * qual delas está.
     *
     * Ligar isto em toda parte seria pior do que não ter: na Lua se anda para
     * fora de uma plataforma o tempo todo, de propósito, e cair de 1/6 de g não
     * machuca ninguém. Uma proteção que atrapalha onde não há o que proteger é
     * uma parede invisível — que é exatamente o que ela existe para evitar.
     */
    this.ledgeGuard = false;

    this.build();
  }

  /**
   * Liga ou desliga o jetpack desta fase.
   *
   * O jogador é o mesmo entre as fases; o equipamento não. Passar `null`
   * devolve o comportamento de sempre — e é o que o vale recebe, sem nenhum
   * `if (lua)` no caminho do movimento.
   */
  setJetpack(jetpack) {
    this.jetpack = jetpack;
    this.jetVelocity.set(0, 0, 0);
  }

  /**
   * O toque no espaço. Uma tecla, dois significados, decididos aqui.
   *
   * No chão é salto. No ar, com jetpack e combustível, é ignição — e o toque é
   * CONSUMIDO pela ignição, senão o mesmo evento tentaria pular e acender.
   */
  onJumpPressed() {
    if (this.jetpack?.onJumpPressed(this.grounded)) return;
    this.queueJump();
  }

  onJumpReleased() {
    this.jetpack?.onJumpReleased();
  }

  /**
   * Cria o controlador, o corpo e a cápsula no mundo de física ATUAL.
   *
   * Separado do construtor porque a troca de fase joga fora o `RAPIER.World`
   * inteiro (ver `PhysicsWorld.recreate`), e com ele vão o controlador de
   * personagem e a cápsula do jogador. O que sobrevive é este objeto e as
   * referências a ele espalhadas pelo jogo — daí a reconstrução ser um método
   * e não um `new`.
   *
   * Lê `player.terrain`, então quem troca a fase precisa apontar o jogador
   * para o terreno novo ANTES de chamar isto: a altura dos pés sai daí.
   */
  build() {
    const { physics, player } = this;
    const radius = CONFIG.player.colliderRadius;
    const halfHeight = Math.max(0.1, (CONFIG.player.height - 2 * radius) / 2);

    this.controller = physics.world.createCharacterController(0.05);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.enableSnapToGround(0.35);
    // O cenário é explorável por inteiro; inclinação não deve virar uma
    // parede invisível antes das árvores. Os obstáculos reais continuam sendo
    // resolvidos pelos colisores de troncos, rochas e cercas.
    this.controller.setMaxSlopeClimbAngle(Math.PI * 0.495);

    /* DEGRAU AUTOMÁTICO — é isto que destrava as bordas de cratera.
     *
     * O terreno é um trimesh, e um trimesh não tem "rampa": tem triângulos. Na
     * borda de uma cratera, onde o relevo sobe rápido dentro de uma célula de
     * um metro, dois triângulos vizinhos formam um DEGRAU quase vertical. O
     * controlador de personagem escorrega em rampas mas não sobe degraus, e
     * como no chão o movimento vertical pedido é zero, ele não tinha por onde
     * subir: o jogador simplesmente parava, com a tecla apertada e sem sair do
     * lugar.
     *
     * Meio metro cobre qualquer lábio que a malha produza (a célula tem 1,15 m
     * no miolo da arena) sem virar teleporte para cima de caixas — a largura
     * mínima de 0,2 m exige que exista superfície onde pisar do outro lado. */
    this.controller.enableAutostep(0.5, 0.2, true);

    const feetY = player.terrain.heightAt(player.position.x, player.position.z);
    player.position.y = feetY;
    const centerY = feetY + CONFIG.player.height / 2;

    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        player.position.x,
        centerY,
        player.position.z,
      ),
    );

    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setFriction(0.8)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    physics.register(this.collider, {
      kind: "character",
      entityId: this.entityId,
      character: player,
      isLocal: true,
    });

    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpQueued = false;
    this.desiredHorizontal.set(0, 0, 0);
    return this;
  }

  /**
   * Refaz a cápsula depois de uma troca de fase.
   *
   * Não há nada a destruir: o mundo antigo inteiro já foi liberado, e tentar
   * remover o corpo velho seria mexer num ponteiro morto.
   */
  rebuild() {
    return this.build();
  }

  queueJump() {
    if (this.grounded) this.jumpQueued = true;
  }

  /** Velocidade horizontal desejada (m/s), consumida em cada passo fixo. */
  setHorizontalMove(vx, vz) {
    this.desiredHorizontal.set(vx, 0, vz);
    /* O jetpack não quer a velocidade, quer a DIREÇÃO: no ar o WASD empurra,
       não desloca. Normalizar aqui é o que faz o empuxo lateral ser o mesmo
       andando ou correndo — no ar não existe "correr". */
    const j = this.jetpack;
    if (j) {
      const m = Math.hypot(vx, vz);
      if (m > 1e-4) j.moveDir.set(vx / m, 0, vz / m);
      else j.moveDir.set(0, 0, 0);
    }
  }

  /** Integra movimento no passo fixo — chamar antes de world.step(). */
  step(h) {
    const p = this.player;
    const terrain = p.terrain;

    if (this.jumpQueued && this.grounded) {
      this.verticalVelocity = CONFIG.player.jumpSpeed;
      this.grounded = false;
      this.jumpQueued = false;
      p.airborne = true;
    }

    const jato = this.jetpack?.step(h, this) ?? false;

    if (!this.grounded) {
      this.verticalVelocity += CONFIG.physics.gravity * h;
      if (jato) this.verticalVelocity += this.jetpack.thrust * h;
    }

    const t = this.body.translation();

    /* Duas formas de andar, e a segunda só existe com jetpack aceso.
     *
     * No chão (e no ar sem jato) o movimento horizontal é uma VELOCIDADE
     * DESEJADA: solta o W e para. É o certo para andar — pernas não têm
     * inércia perceptível.
     *
     * Com o jato aceso, WASD vira ACELERAÇÃO sobre a velocidade que já existe.
     * A diferença não é sutil: com velocidade desejada, um jetpack para no ar
     * assim que a tecla é solta, e voar fica com a inércia de um cursor de
     * mouse. Com aceleração, o corpo continua na direção em que estava indo e a
     * correção custa tempo — que é o que torna pousar no topo de um foguete uma
     * manobra em vez de um clique. */
    const horizontal = jato ? this.jetVelocity : this.desiredHorizontal;

    const desired = {
      x: horizontal.x * h,
      y: this.grounded ? 0 : this.verticalVelocity * h,
      z: horizontal.z * h,
    };

    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    this._corrected.set(m.x, m.y, m.z);

    let nx = t.x + this._corrected.x;
    let nz = t.z + this._corrected.z;
    let ny = t.y + this._corrected.y;

    const feetGround =
      terrain.heightAt(nx, nz) + CONFIG.player.height / 2;

    /* Existem DUAS formas de estar no chão, e antes só uma contava.
     *
     * A primeira é o terreno, que é uma função analítica de altura. A segunda é
     * qualquer COLISOR sob os pés — pedra, tronco caído, cerca —, e quem
     * responde por ela é o próprio controlador de personagem, que acabou de
     * resolver o movimento contra a cena inteira.
     *
     * Sem a segunda, quem pulava em cima de uma pedra ficava para sempre na
     * pose de salto: o corpo parava sobre a rocha, mas continuava "no ar" para
     * o resto do jogo, com as pernas encolhidas.
     *
     * Só aterrissa descendo: o primeiro avanço do pulo (~7 cm) cai dentro da
     * tolerância e seria cancelado na hora.
     */
    const descendo = this.verticalVelocity <= 0;
    const sobreTerreno = descendo && ny <= feetGround + 0.08;
    const sobreColisor = descendo && this.controller.computedGrounded();

    if (sobreTerreno || sobreColisor) {
      /* O TERRENO SÓ ERGUE — NUNCA PUXA PARA BAIXO. É a linha que faz uma
       * rampa de alvenaria sobre chão plano ser subível.
       *
       * A folga de 2 cm não é frescura: `heightAt` é uma função contínua e o
       * colisor é um trimesh que a amostra nos vértices. Entre dois vértices,
       * onde o relevo é curvo — a borda de uma cratera é o caso —, o triângulo
       * plano fica ACIMA da curva. Colar a cápsula na altura analítica a enfia
       * dentro da malha, e um colisor penetrado é um colisor que não deixa mais
       * ninguém andar.
       *
       * Mas a versão anterior ATRIBUÍA essa altura sempre que o corpo estivesse
       * a menos de 8 cm do terreno — inclusive quando ele estava SUBINDO em
       * cima de outra coisa. Andando a 4 m/s numa rampa de 30°, o passo de um
       * quadro sobe 3,8 cm: menos que a tolerância. O corpo ganhava os 3,8 cm
       * pelo controlador e era recolado no terreno no mesmo quadro, para
       * sempre. Na tela, isso eram as duas escadas do castelo: dava para
       * atravessar a rampa inteira por baixo, no nível do pátio, sem nunca
       * subir um degrau.
       *
       * Comparar em vez de atribuir resolve os dois casos com uma regra só —
       * o chão é o MAIS ALTO dos dois. */
      const doTerreno = feetGround + 0.02;
      if (sobreTerreno && doTerreno >= ny) ny = doTerreno;
      this.verticalVelocity = 0;
      this.grounded = true;
      p.airborne = false;
    } else {
      this.grounded = false;
      p.airborne = true;
    }

    /* A BEIRA MORTAL. O corpo não ANDA para dentro de uma queda que o mata.
     *
     * O adarve não tem parapeito, e isso é decisão de projeto, não esquecimento:
     * o §6.4 do plano do cerco mediu que qualquer borda ali — de dez
     * centímetros para cima — corta justamente o tiro no portão, que é a razão
     * de existir da hourd. Medido de novo agora, contra a geometria de hoje: a
     * flecha que vai à fila do portão passa a CINCO CENTÍMETROS do deque na
     * beira externa. Não cabe pedra nenhuma ali.
     *
     * Só que a faixa de onde se atira tem 90 cm, e ela termina em oito metros
     * de queda. Sem nada, o primeiro passo à frente mata — e o modo nasce
     * apontando o jogador para esse lado.
     *
     * A saída não é construir: é o CORPO se recusar. Andando, o passo que
     * deixaria os pés sem chão dentro de `fatalFall` é cancelado — e só ele,
     * componente a componente, para continuar dando para andar RENTE à beira.
     * Pular continua funcionando (o teste só vale com os pés no chão), e
     * descer um degrau, um talude ou o próprio muro por um salto continua
     * sendo escolha de quem joga.
     *
     * Custa até três raios por quadro, só para o jogador local, e só quando ele
     * está andando no chão. */
    if (
      this.ledgeGuard &&
      this.grounded &&
      (this._corrected.x !== 0 || this._corrected.z !== 0)
    ) {
      const seguro = (x, z) => this.temChao(x, z, ny);
      if (!seguro(nx, nz)) {
        if (seguro(nx, t.z)) nz = t.z;
        else if (seguro(t.x, nz)) nx = t.x;
        else {
          nx = t.x;
          nz = t.z;
        }
      }
    }

    /* A BARREIRA. Aqui ela é só isto: um ponto onde `isWalkable` diz não.
     *
     * Só o horizontal é revertido. Congelar `y` junto — que era o que acontecia
     * — prendia no ar quem chegasse à barreira voando de jetpack: a pessoa
     * ficava suspensa contra uma parede invisível em vez de escorregar por ela
     * e continuar caindo.
     *
     * E ELA SÓ VALE COM OS PÉS NO TERRENO. `isWalkable` responde sobre a
     * INCLINAÇÃO do campo de altura, e quem está em cima de alvenaria não está
     * sobre o campo de altura — está treze metros acima dele.
     *
     * No castelo isso era uma queda através do chão. O esporão é um
     * despenhadeiro a partir de z ≈ 9, e a hourd e os bastiões se projetam
     * exatamente POR CIMA dele (até z = 9,2 e 10,5). Andar para o bordo do
     * adarve — que é de onde se atira — punha o corpo sobre uma célula íngreme,
     * a barreira disparava, e o `ny` era reatribuído à cota do TERRENO: o
     * jogador aparecia no pé da falésia, a treze metros abaixo, tendo
     * atravessado a própria muralha. Era o "cai por dentro das paredes".
     *
     * A folga de 1 m é maior que qualquer discrepância entre a altura analítica
     * e o trimesh (medida em ladeira: 0,24 m) e muito menor que a menor
     * alvenaria pisável do jogo. */
    const naAlvenaria =
      ny - CONFIG.player.height / 2 > terrain.heightAt(nx, nz) + 1.0;
    if (!naAlvenaria && !terrain.isWalkable(nx, nz)) {
      nx = t.x;
      nz = t.z;
      this.jetVelocity.set(0, 0, 0);
      if (this.grounded) {
        ny = terrain.heightAt(nx, nz) + CONFIG.player.height / 2;
      }
    }

    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });

    p.position.x = nx;
    p.position.z = nz;
    // `position` é a posição dos PÉS. Durante o pulo ela precisa acompanhar
    // o centro do colisor; colá-la sempre no heightAt escondia todo o salto.
    p.position.y = ny - CONFIG.player.height / 2;

  }

  /**
   * Há chão sob (x, z) dentro da queda que ainda dá para sobreviver?
   *
   * Duas fontes, e as duas precisam ser consultadas pelo mesmo motivo que
   * `step` já consulta as duas para decidir se está no chão: o TERRENO é uma
   * função de altura e a ALVENARIA é colisor. Um teste só contra o terreno
   * diria que não há chão em cima do muro inteiro; um teste só contra colisores
   * diria que não há chão no vale inteiro.
   *
   * O raio parte um pouco ABAIXO dos pés, senão ele começa dentro do próprio
   * piso em que se está e volta com distância zero em toda parte.
   *
   * @param {number} yCentro cota do centro do colisor no destino
   */
  temChao(x, z, yCentro) {
    const queda = CONFIG.player.ledgeGuardDrop;
    const pes = yCentro - CONFIG.player.height / 2;

    // 1. O terreno. Se ele está logo abaixo dos pés, há chão e acabou.
    if (this.player.terrain.heightAt(x, z) > pes - queda) return true;

    // 2. Alvenaria, plataforma, tronco caído — o que o terreno não conhece.
    _ray ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    _ray.origin.x = x;
    _ray.origin.y = pes - 0.12;
    _ray.origin.z = z;
    return this.physics.world.castRay(_ray, queda, true) != null;
  }

  getHitBody() {
    return this.body;
  }

  syncFromPlayer() {
    const p = this.player;
    const y = p.position.y + CONFIG.player.height / 2;
    this.body.setTranslation({ x: p.position.x, y, z: p.position.z }, true);
  }

  /**
   * Teleporta e deixa no ar — o caminho de nascer.
   *
   * A queda de 10 m não ganha física própria: é este mesmo controlador, só com
   * a altura inicial trocada. Por isso ela já acerta o relevo, escorrega em
   * encosta e para no chão sem uma linha nova.
   */
  teleport(x, y, z) {
    this.player.position.set(x, y, z);
    this.body.setTranslation(
      { x, y: y + CONFIG.player.height / 2, z },
      true,
    );
    this.verticalVelocity = 0;
    this.grounded = false;
    this.player.airborne = true;
    this.desiredHorizontal.set(0, 0, 0);
  }
}
