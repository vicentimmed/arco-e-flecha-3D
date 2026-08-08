/* ---------------------------------------------------------------------------
   Grupos de colisão do Rapier.

   O número é um filtro de 32 bits:
   • bits 16–31: grupos aos quais o colisor pertence;
   • bits 0–15: grupos que ele aceita.

   Flechas continuam acertando os NPCs, mas NPCs não formam uma malha de
   contatos entre si. A separação visual é resolvida pela IA do servidor.
   --------------------------------------------------------------------------- */

export const COLLISION_GROUP_ARROW = 1 << 0;
export const COLLISION_GROUP_NPC = 1 << 1;

/** Flecha: pertence ao grupo 1 e aceita todos, menos outras flechas. */
export const ARROW_COLLISION_GROUPS =
  (COLLISION_GROUP_ARROW << 16) | 0xfffe;

/** NPC: pertence ao grupo 2 e só aceita a hitbox de flecha. */
export const NPC_COLLISION_GROUPS =
  (COLLISION_GROUP_NPC << 16) | COLLISION_GROUP_ARROW;
