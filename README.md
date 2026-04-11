# ⛽ Controle de Abastecimento — Frota

App PWA de controle de abastecimento com leitura de QR Code para motoristas e veículos.

---

## 📁 Estrutura do projeto

```
frota-app/
├── public/
│   ├── index.html
│   ├── manifest.json       ← configura o PWA
│   ├── service-worker.js   ← permite uso offline
│   ├── icon-192.png
│   └── icon-512.png
├── src/
│   ├── index.js            ← entrada do React
│   └── App.jsx             ← app completo
├── package.json
└── README.md
```

---

## 🚀 Como publicar (passo a passo)

### 1. Criar repositório no GitHub

1. Acesse [github.com](https://github.com) e faça login
2. Clique no **+** no canto superior direito → **New repository**
3. Nome: `frota-abastecimento`
4. Deixe **Public** marcado
5. Clique em **Create repository**

### 2. Fazer upload dos arquivos

Na página do repositório criado:

1. Clique em **uploading an existing file**
2. Arraste **todos os arquivos e pastas** deste projeto
3. Clique em **Commit changes**

> ⚠️ Importante: mantenha a estrutura de pastas (`public/` e `src/` separadas)

### 3. Publicar no Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login com GitHub
2. Clique em **Add New Project**
3. Selecione o repositório `frota-abastecimento`
4. Em **Framework Preset** selecione **Create React App**
5. Clique em **Deploy**
6. Aguarde ~2 minutos ✅

### 4. Instalar no celular como app

Após o deploy, o Vercel vai gerar um link como `https://frota-abastecimento.vercel.app`

**Android (Chrome):**
1. Abra o link no Chrome
2. Toque nos **3 pontos** no canto superior
3. Toque em **Adicionar à tela inicial**
4. Confirme → o app aparece na tela inicial 📱

**iPhone (Safari):**
1. Abra o link no Safari
2. Toque em **Compartilhar** (ícone de caixa com seta)
3. Toque em **Adicionar à Tela de Início**
4. Confirme → app instalado 📱

---

## ✅ Funcionalidades

- Cadastro de departamentos, veículos e motoristas
- Geração de QR Code para cada motorista (crachá) e veículo (painel)
- Leitura de QR Code pela câmera para identificação rápida
- Seleção manual como alternativa
- Registro de abastecimentos com data, combustível, litros, custo e operador
- Cálculo automático de preço por litro
- Exportação em CSV compatível com Excel
- Funciona offline após primeira visita

---

## 🛠 Tecnologias

- React 18
- PWA (manifest + service worker)
- BarcodeDetector API (leitura nativa de QR)
- QR Server API (geração de QR codes)
