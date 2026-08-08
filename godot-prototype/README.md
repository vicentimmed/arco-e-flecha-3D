# Arco & Flecha — protótipo Godot

Vertical slice offline do jogo para validar a migração para Godot antes de
portar o multiplayer e os outros modos.

## Versão

- Godot 4.7.1-stable.
- Build padrão com GDScript; não é necessário o build `.NET`.
- Renderer inicial: `gl_compatibility`.
- Física: 120 ticks por segundo.

Antes de alterar este projeto, leia a regra permanente em
[`../.cursor/rules/godot-project.mdc`](../.cursor/rules/godot-project.mdc).

## Abrir na IDE

1. Instale o Godot 4.7.1-stable pelo [arquivo oficial de downloads](https://godotengine.org/download/archive/4.7.1-stable/).
2. Abra o Project Manager.
3. Clique em **Import** e selecione este diretório ou o arquivo
   `project.godot`.
4. Abra o projeto e execute `scenes/Main.tscn` com **Play Project**.

O arquivo `project.godot` precisa permanecer na raiz deste diretório. Todos os
recursos do projeto usam caminhos `res://`.

## Validação por terminal

Na raiz do repositório:

```bash
godot --version
godot --headless --path godot-prototype --editor --quit
godot --path godot-prototype -e
godot --headless --path godot-prototype --script res://tests/self_test.gd
```

O editor deve abrir sem erros de parse, cenas ausentes ou recursos quebrados.
O self-test termina com código diferente de zero quando algum critério falha.

## Controles

- Mouse: olhar.
- Botão esquerdo: tensionar e soltar para disparar.
- `C`: alternar primeira e terceira pessoa.
- `Esc`: liberar o mouse.
- `R`: reiniciar o alvo e limpar as flechas.
- `F3`: mostrar ou esconder o painel de diagnóstico.

## Escopo

O protótipo contém terreno procedural determinístico, arqueira simplificada,
câmera sobre o ombro, arco, flecha com gravidade/arrasto/vento e um alvo físico
com pontuação por anéis. Ele não usa o servidor Node, WebSocket, Steam ou os
modos multiplayer do projeto atual.
