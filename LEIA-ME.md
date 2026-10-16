# Teste do Mira dentro do Media Station X (MSX)

Objetivo: descobrir, na sua TV Samsung, 4 coisas antes de investir mais.

1. O MSX entrega um ID do aparelho? (base da licença por aparelho)
2. A TV toca HLS (.m3u8), TS (.ts) e MP4 pelo player do MSX?
3. Uma lista M3U sua abre e os canais tocam?
4. O controle remoto navega bem?

Este teste foi montado a partir da documentação do MSX e verificado só num simulador. Ele **nunca rodou no MSX de verdade**. Se alguma tela falhar, é uma informação útil: tire uma foto e me mande.

## Passo 1: colocar no GitHub Pages (uns 10 minutos)

1. Crie uma conta em github.com (se ainda não tiver). Anote seu **nome de usuário**.
2. Clique em **New repository**. Em *Repository name* escreva exatamente `SEU-USUARIO.github.io` (troque pelo seu usuário, tudo minúsculo). Deixe **Public** e crie.
3. Na página do repositório, clique em **uploading an existing file**. Arraste para lá **a pasta `msx`** e o arquivo **`.nojekyll`** deste pacote (arquivos que começam com ponto podem ficar escondidos no seu computador; se não achar, tudo bem, o teste funciona sem ele). Clique em **Commit changes**.
4. Vá em **Settings → Pages**. Em *Branch* escolha `main` e `/ (root)`, e clique **Save**.
5. Espere 1 a 2 minutos e abra no navegador do computador: `https://SEU-USUARIO.github.io/msx/start.json`. Deve aparecer um texto começando por `{ "name": "Mira (teste)"`. Se aparecer, está no ar.

## Passo 2: configurar o MSX na TV

1. Abra o Media Station X.
2. Vá em **Settings → Start Parameter → Setup**.
3. Digite `SEU-USUARIO.github.io` (só isso, sem https).
4. Ative o **cadeado de segurança (HTTPS)** e confirme.
5. Feche e abra o MSX de novo. Deve aparecer o menu **Mira - teste**.

## Passo 3: o que olhar e me contar

- **1. Aparelho**: tire uma foto da tela inteira. As linhas mais importantes são `ID do aparelho` e `MAC pelo webapis`.
- **2. Vídeos de teste**: toque os quatro. Anote quais tocam (imagem e som) e quais dão erro. O vídeo mostra um relógio, então dá para ver se trava.
- **3. Minha lista M3U**: escolha "Digitar o link…", digite o link da sua lista e confirme. **Atenção:** o link passa pelo servidor do MSX, então não use uma lista com senha que você não queira expor. Se o link tiver `&` e não abrir, tente um link curto.
- **Controle remoto**: foi fácil navegar? O teclado na tela foi suportável?

## Se o menu não aparecer

- Confira o passo 5 do Passo 1.
- Se o endereço funciona no navegador mas não na TV, tire uma foto do erro que o MSX mostrar.
- Se o MSX reclamar do endereço, tente sem o cadeado HTTPS.

## Observações

- Os vídeos de teste foram gerados aqui (H.264 + AAC, 12 segundos) e não têm direitos autorais.
- Nenhum dado seu é enviado para mim. A página só é lida pela sua TV.
