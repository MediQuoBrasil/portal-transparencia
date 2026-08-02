/**
 * ═══════════════════════════════════════════════════════════
 *  relatorios.js — Parsing de planilha e geração de relatórios
 * ═══════════════════════════════════════════════════════════
 *
 *  Lógica portada do index.html (MVP) sem alteração funcional.
 *  Parsing: SheetJS → extrai profissionais e plantões.
 *  Geração: ExcelJS (xlsx) e jsPDF + AutoTable (PDFs individuais).
 *
 *  Dependências CDN:
 *  - SheetJS (xlsx-0.20.3)
 *  - ExcelJS (4.4.0)
 *  - jsPDF (2.5.1) + jspdf-autotable (3.8.4)
 *  - JSZip (3.10.1) + FileSaver.js (2.0.5)
 */

(function () {
  'use strict';

  // ─── Typedefs ────────────────────────────────────────────

  /**
   * @typedef {Object} Plantao
   * @property {string} inicio      - "DD/MM/AAAA HH:MM"
   * @property {string} fim         - "DD/MM/AAAA HH:MM"
   * @property {string} duracaoStr  - "HH:MM"
   * @property {number} duracaoHoras - Horas decimais
   * @property {number} valor       - Valor em reais (inteiro)
   * @property {string} tipo        - Tipo do plantão ("Normal", "SOS", etc.)
   */

  /**
   * @typedef {Object} Profissional
   * @property {string}    nome          - Nome completo
   * @property {string}    crm           - CRM/UF
   * @property {Plantao[]} plantoes      - Lista de plantões
   * @property {number}    totalPlantoes - Quantidade de plantões
   * @property {number}    totalHoras    - Total de horas (decimal)
   * @property {number}    totalValor    - Total em reais
   */

  /**
   * @typedef {Object} Vigencia
   * @property {string} inicio - "DD/MM/AAAA"
   * @property {string} fim    - "DD/MM/AAAA"
   * @property {string} raw    - String original "DD/MM/AAAA~DD/MM/AAAA"
   * @property {string} curta  - Formato curto "DD/MM a DD/MM"
   */

  /**
   * @typedef {Object} DadosRelatorio
   * @property {Vigencia}       vigencia      - Dados da vigência
   * @property {Profissional[]} profissionais  - Lista de profissionais
   * @property {Object}         totalGeral     - Totais gerais
   * @property {number}         totalGeral.plantoes
   * @property {number}         totalGeral.horas
   * @property {number}         totalGeral.valor
   */

  /**
   * @typedef {Object} RelatorioCallbacks
   * @property {function(string, string): void} onFeedback  - (msg, tipo)
   * @property {function(number, number): void} onProgresso - (atual, total)
   * @property {function(): void}               onProgressoFim
   * @property {function(boolean): void}        onBotoes    - habilita/desabilita
   */

  // ─── Estilos ExcelJS compartilhados ──────────────────────

  /** @type {string} */
  const ROXO_HEX = 'FF491E9C';

  /** @type {Object} */
  const BORDA_FINA = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
  };

  /** @type {Object} */
  const FONT_HEADER_BRANCO = { bold: true, size: 12, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };

  /** @type {Object} */
  const FONT_COLUNA = { bold: true, size: 12, color: { argb: 'FF000000' }, name: 'Calibri' };

  /** @type {Object} */
  const FONT_DADO = { bold: false, size: 12, color: { argb: 'FF000000' }, name: 'Calibri' };

  /** @type {Object} */
  const FONT_TOTAL_PRETO = { bold: true, size: 12, color: { argb: 'FF000000' }, name: 'Calibri' };

  /** @type {Object} */
  const FILL_ROXO = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROXO_HEX } };

  /** @type {string} */
  const NUMFMT_VALOR_DATA = '"R$" #,##0.00';

  /** @type {string} */
  const NUMFMT_VALOR_TOTAL = '"R$" #,##0;[Red]-"R$" #,##0';

  // ─── Parsing ─────────────────────────────────────────────

  /**
   * Parseia as linhas da planilha FinanceiroEntradaSaida.
   *
   * Formato: 12 colunas.
   * Colunas usadas: C(2)=Início, D(3)=Fim, I(8)=Duração(h), K(10)=Valor.
   * Regex profissional: `NomeProfissional  -  CRM/UF`.
   *
   * @param {Array[]} rows - Linhas da planilha (SheetJS sheet_to_json header:1).
   * @returns {DadosRelatorio} Dados parseados para geração de relatórios.
   */
  const parsearPlanilha = (rows) => {
    // 1) Vigência da linha 3 (índice 2): "21/06/2026~20/07/2026"
    const vigenciaRaw = String(rows[2][0]).trim();
    const vigenciaParts = vigenciaRaw.split('~');
    const vigencia = {
      inicio: vigenciaParts[0].trim(),
      fim: vigenciaParts[1].trim(),
      raw: vigenciaRaw,
      curta: window.Utils.formatarVigenciaCurta(vigenciaRaw),
    };

    /** @type {Profissional[]} */
    const profissionais = [];

    /** @type {Profissional|null} */
    let profAtual = null;

    const regexProf = /^(.+?)\s{2}-\s{2}(\d+\/[A-Z]{2})$/;

    // 2) Iterar a partir da linha 5 (índice 4)
    for (let i = 4; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;

      const colA = row[0] != null ? String(row[0]).trim() : null;
      const colB = row[1] != null ? String(row[1]).trim() : null;
      const colC = row[2] != null ? String(row[2]).trim() : null;
      const colD = row[3] != null ? String(row[3]).trim() : null;
      const colI = row[8] != null ? String(row[8]).trim() : null;
      const colK = row[10];

      // Parar no "Total Geral"
      if (colA === 'Total Geral') break;

      // Linha vazia
      if (!colA && !colB && !colC && !colD && !colI && colK == null) continue;

      // Linha de profissional (só coluna A com padrão nome - CRM)
      if (colA && !colB && !colC) {
        const match = colA.match(regexProf);
        if (match) {
          if (profAtual) profissionais.push(profAtual);
          profAtual = {
            nome: match[1].trim(),
            crm: match[2].trim(),
            plantoes: [],
            totalPlantoes: 0,
            totalHoras: 0,
            totalValor: 0,
          };
          continue;
        }
      }

      // Cabeçalho de colunas
      if (colA === 'Setor') continue;

      // Total do profissional (coluna C = "Total")
      if (colC === 'Total' && profAtual) {
        let somaValor = 0;
        let somaHoras = 0;
        profAtual.plantoes.forEach((p) => {
          somaValor += p.valor;
          somaHoras += p.duracaoHoras;
        });
        profAtual.totalPlantoes = profAtual.plantoes.length;
        profAtual.totalHoras = somaHoras;
        profAtual.totalValor = somaValor;
        continue;
      }

      // Linha de plantão (colC = "DD/MM/AAAA HH:MM")
      if (colC && profAtual) {
        if (/^\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/.test(colC)) {
          const valor = typeof colK === 'number' ? colK : parseInt(String(colK), 10) || 0;
          const duracaoStr = window.Utils.normalizarDuracao(colI);
          const tipo = colB ? colB : 'Normal';
          profAtual.plantoes.push({
            inicio: colC,
            fim: colD || '',
            duracaoStr,
            duracaoHoras: window.Utils.duracaoParaHorasDecimal(colI),
            valor,
            tipo,
          });
        }
      }
    }

    // Último profissional
    if (profAtual) {
      if (profAtual.totalPlantoes === 0 && profAtual.plantoes.length > 0) {
        let somaValor = 0;
        let somaHoras = 0;
        profAtual.plantoes.forEach((p) => {
          somaValor += p.valor;
          somaHoras += p.duracaoHoras;
        });
        profAtual.totalPlantoes = profAtual.plantoes.length;
        profAtual.totalHoras = somaHoras;
        profAtual.totalValor = somaValor;
      }
      profissionais.push(profAtual);
    }

    // 3) Totais gerais
    let totalGeralPlantoes = 0;
    let totalGeralHoras = 0;
    let totalGeralValor = 0;
    profissionais.forEach((p) => {
      totalGeralPlantoes += p.totalPlantoes;
      totalGeralHoras += p.totalHoras;
      totalGeralValor += p.totalValor;
    });

    return {
      vigencia,
      profissionais,
      totalGeral: {
        plantoes: totalGeralPlantoes,
        horas: totalGeralHoras,
        valor: totalGeralValor,
      },
    };
  };

  // ─── Relatório por Dia (.xlsx) ───────────────────────────

  /**
   * Gera o relatório por dia (.xlsx) com ExcelJS.
   *
   * 6 colunas: Data | Profissional | Início | Fim | Duração (h) | Valor (R$).
   * Agrupado por data, com subtotal por dia e total geral.
   *
   * @param {DadosRelatorio} dados - Dados parseados.
   * @param {RelatorioCallbacks} cb - Callbacks de UI.
   * @returns {Promise<void>}
   */
  const gerarRelatorioPorDia = async (dados, cb) => {
    cb.onBotoes(false);
    cb.onFeedback('Gerando relatório por dia...', 'info');
    await new Promise((r) => { setTimeout(r, 50); });

    try {
      const NUM_COLS = 6;

      // 1) Reunir todos os plantões
      const todosPlantoes = [];
      dados.profissionais.forEach((prof) => {
        prof.plantoes.forEach((pl) => {
          todosPlantoes.push({
            data: window.Utils.extrairData(pl.inicio),
            profissional: prof.nome,
            inicio: pl.inicio,
            fim: pl.fim,
            duracaoHoras: pl.duracaoHoras,
            valor: pl.valor,
          });
        });
      });

      // 2) Ordenar por data + profissional
      todosPlantoes.sort((a, b) => {
        const da = window.Utils.dataParaSort(a.data);
        const db = window.Utils.dataParaSort(b.data);
        if (da.getTime() !== db.getTime()) return da - db;
        return a.profissional.localeCompare(b.profissional, 'pt-BR');
      });

      // 3) Agrupar por data
      /** @type {Object<string, Object[]>} */
      const gruposPorDia = {};
      /** @type {string[]} */
      const ordemDias = [];
      todosPlantoes.forEach((p) => {
        if (!gruposPorDia[p.data]) {
          gruposPorDia[p.data] = [];
          ordemDias.push(p.data);
        }
        gruposPorDia[p.data].push(p);
      });

      // 4) Criar workbook
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Relatório por Dia');

      ws.columns = [
        { key: 'A', width: 12.86 },
        { key: 'B', width: 35.86 },
        { key: 'C', width: 18.86 },
        { key: 'D', width: 18.86 },
        { key: 'E', width: 13.57 },
        { key: 'F', width: 14.86 },
      ];

      let totalGeralHoras = 0;
      let totalGeralValor = 0;

      // 5) Montar planilha
      ordemDias.forEach((dia, idx) => {
        const plantoesDia = gruposPorDia[dia];

        // Cabeçalho do dia: merged A:F, roxo, branco bold, center
        const rowH = ws.addRow([`${dia}:`, '', '', '', '', '']);
        ws.mergeCells(rowH.number, 1, rowH.number, NUM_COLS);
        for (let c = 1; c <= NUM_COLS; c += 1) {
          const cell = ws.getCell(rowH.number, c);
          cell.font = FONT_HEADER_BRANCO;
          cell.fill = FILL_ROXO;
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        // Cabeçalho de colunas: bold, bordas
        const rowC = ws.addRow(['Data', 'Profissional', 'Início', 'Fim', 'Duração (h)', 'Valor (R$)']);
        for (let c = 1; c <= NUM_COLS; c += 1) {
          const cell = ws.getCell(rowC.number, c);
          cell.font = FONT_COLUNA;
          cell.border = BORDA_FINA;
          if (c >= 5) cell.alignment = { horizontal: 'center' };
        }

        // Linhas de dados
        let somaHorasDia = 0;
        let somaValorDia = 0;

        plantoesDia.forEach((p) => {
          const rowD = ws.addRow([p.data, p.profissional, p.inicio, p.fim, p.duracaoHoras, p.valor]);
          for (let c = 1; c <= NUM_COLS; c += 1) {
            const cell = ws.getCell(rowD.number, c);
            cell.font = FONT_DADO;
            cell.border = BORDA_FINA;
            if (c >= 5) cell.alignment = { horizontal: 'center' };
          }
          ws.getCell(rowD.number, NUM_COLS).numFmt = NUMFMT_VALOR_DATA;
          somaHorasDia += p.duracaoHoras;
          somaValorDia += p.valor;
        });

        totalGeralHoras += somaHorasDia;
        totalGeralValor += somaValorDia;

        // TOTAL do dia: merged A:D, bold
        const rowT = ws.addRow([
          'TOTAL', '', '', '',
          window.Utils.formatarTotalHoras(somaHorasDia),
          somaValorDia,
        ]);
        ws.mergeCells(rowT.number, 1, rowT.number, 4);
        for (let c = 1; c <= NUM_COLS; c += 1) {
          const cell = ws.getCell(rowT.number, c);
          cell.font = FONT_TOTAL_PRETO;
          cell.border = BORDA_FINA;
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        ws.getCell(rowT.number, NUM_COLS).numFmt = NUMFMT_VALOR_TOTAL;

        // Linha vazia separadora (exceto último)
        if (idx < ordemDias.length - 1) {
          ws.addRow([]);
        }
      });

      // TOTAL GERAL: merged A:D, roxo, branco bold
      ws.addRow([]);
      const rowG = ws.addRow([
        'TOTAL:', '', '', '',
        window.Utils.formatarTotalHoras(totalGeralHoras),
        totalGeralValor,
      ]);
      ws.mergeCells(rowG.number, 1, rowG.number, 4);
      for (let c = 1; c <= NUM_COLS; c += 1) {
        const cell = ws.getCell(rowG.number, c);
        cell.font = FONT_HEADER_BRANCO;
        cell.fill = FILL_ROXO;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      ws.getCell(rowG.number, NUM_COLS).numFmt = NUMFMT_VALOR_TOTAL;

      // 6) Gerar e baixar
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, `Relatório por dia - Clínica geral - ${dados.vigencia.curta}.xlsx`);
      cb.onFeedback('Relatório por dia gerado com sucesso!', 'success');
    } catch (err) {
      console.error(err);
      cb.onFeedback(`Erro ao gerar relatório: ${err.message}`, 'error');
    } finally {
      cb.onBotoes(true);
    }
  };

  // ─── Relatório por Profissional (.xlsx) ──────────────────

  /**
   * Gera o relatório por profissional (.xlsx) com ExcelJS.
   *
   * 4 colunas: Início | Fim | Duração (h) | Valor (R$).
   * Agrupado por profissional (ordem alfabética), com subtotal e total geral.
   *
   * @param {DadosRelatorio} dados - Dados parseados.
   * @param {RelatorioCallbacks} cb - Callbacks de UI.
   * @returns {Promise<void>}
   */
  const gerarRelatorioPorProfissional = async (dados, cb) => {
    cb.onBotoes(false);
    cb.onFeedback('Gerando relatório por profissional...', 'info');
    await new Promise((r) => { setTimeout(r, 50); });

    try {
      const NUM_COLS = 4;

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Relatório por Profissional');

      ws.columns = [
        { key: 'A', width: 19 },
        { key: 'B', width: 19 },
        { key: 'C', width: 13.86 },
        { key: 'D', width: 15 },
      ];

      let totalGeralHoras = 0;
      let totalGeralValor = 0;

      // Profissionais ordenados alfabeticamente
      const profsOrdenados = [...dados.profissionais].sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR'),
      );

      profsOrdenados.forEach((prof, idx) => {
        // Cabeçalho do profissional: merged A:D, roxo, branco bold
        const nomeHeader = `${prof.nome} (${prof.crm}):`;
        const rowH = ws.addRow([nomeHeader, '', '', '']);
        ws.mergeCells(rowH.number, 1, rowH.number, NUM_COLS);
        for (let c = 1; c <= NUM_COLS; c += 1) {
          const cell = ws.getCell(rowH.number, c);
          cell.font = FONT_HEADER_BRANCO;
          cell.fill = FILL_ROXO;
          cell.alignment = { vertical: 'middle' };
          if (c >= 3) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        // Cabeçalho de colunas: bold, bordas
        const rowC = ws.addRow(['Início', 'Fim', 'Duração (h)', 'Valor (R$)']);
        for (let c = 1; c <= NUM_COLS; c += 1) {
          const cell = ws.getCell(rowC.number, c);
          cell.font = FONT_COLUNA;
          cell.border = BORDA_FINA;
          if (c >= 3) cell.alignment = { horizontal: 'center' };
        }

        // Linhas de dados
        prof.plantoes.forEach((p) => {
          const rowD = ws.addRow([p.inicio, p.fim, p.duracaoHoras, p.valor]);
          for (let c = 1; c <= NUM_COLS; c += 1) {
            const cell = ws.getCell(rowD.number, c);
            cell.font = FONT_DADO;
            cell.border = BORDA_FINA;
            if (c >= 3) cell.alignment = { horizontal: 'center' };
          }
          ws.getCell(rowD.number, NUM_COLS).numFmt = NUMFMT_VALOR_DATA;
        });

        totalGeralHoras += prof.totalHoras;
        totalGeralValor += prof.totalValor;

        // TOTAL do profissional: merged A:B, bold
        const rowT = ws.addRow([
          'TOTAL:', '',
          window.Utils.formatarTotalHoras(prof.totalHoras),
          prof.totalValor,
        ]);
        ws.mergeCells(rowT.number, 1, rowT.number, 2);
        for (let c = 1; c <= NUM_COLS; c += 1) {
          const cell = ws.getCell(rowT.number, c);
          cell.font = FONT_TOTAL_PRETO;
          cell.border = BORDA_FINA;
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        ws.getCell(rowT.number, NUM_COLS).numFmt = NUMFMT_VALOR_TOTAL;

        // Linha vazia separadora (exceto último)
        if (idx < profsOrdenados.length - 1) {
          ws.addRow([]);
        }
      });

      // TOTAL GERAL: merged A:B, roxo, branco bold
      ws.addRow([]);
      const rowG = ws.addRow([
        'TOTAL:', '',
        window.Utils.formatarTotalHoras(totalGeralHoras),
        totalGeralValor,
      ]);
      ws.mergeCells(rowG.number, 1, rowG.number, 2);
      for (let c = 1; c <= NUM_COLS; c += 1) {
        const cell = ws.getCell(rowG.number, c);
        cell.font = FONT_HEADER_BRANCO;
        cell.fill = FILL_ROXO;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      ws.getCell(rowG.number, NUM_COLS).numFmt = NUMFMT_VALOR_TOTAL;

      // Gerar e baixar
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, `Relatório por profissional - Clínica geral - ${dados.vigencia.curta}.xlsx`);
      cb.onFeedback('Relatório por profissional gerado com sucesso!', 'success');
    } catch (err) {
      console.error(err);
      cb.onFeedback(`Erro ao gerar relatório: ${err.message}`, 'error');
    } finally {
      cb.onBotoes(true);
    }
  };

  // ─── PDF Individual ──────────────────────────────────────

  /**
   * Gera um PDF individual para um profissional.
   *
   * Landscape A4, 4 colunas: Início | Fim | Duração (h) | Valor (R$).
   * Cabeçalho roxo, fonte Helvetica, linha de total no final.
   *
   * @param {Profissional} prof - Dados do profissional.
   * @param {Vigencia} vigencia - Dados da vigência.
   * @returns {Blob} Blob do PDF gerado.
   */
  const gerarPDFIndividual = (prof, vigencia) => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('Biblioteca jsPDF não carregou. Recarregue a página e tente novamente.');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const roxo = [73, 30, 156];
    const cinzaClaro = [245, 245, 247];
    const textoPrincipal = [26, 26, 46];
    const pageWidth = doc.internal.pageSize.getWidth();

    // Cabeçalho
    doc.setFillColor(...roxo);
    doc.rect(0, 0, pageWidth, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text('Relatório Individual de Plantões', 15, 8);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('MediQuo — Clínica Geral', 15, 14);
    doc.setFontSize(8);
    doc.text(`Vigência: ${vigencia.inicio} a ${vigencia.fim}`, pageWidth - 15, 8, { align: 'right' });

    // Dados do profissional
    doc.setTextColor(...textoPrincipal);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(prof.nome, 15, 26);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text(`CRM: ${prof.crm}`, 15, 31);

    // Tabela
    const colunas = [
      { header: 'Início', dataKey: 'inicio' },
      { header: 'Fim', dataKey: 'fim' },
      { header: 'Duração (h)', dataKey: 'duracao' },
      { header: 'Valor (R$)', dataKey: 'valor' },
    ];

    const linhas = prof.plantoes.map((p) => ({
      inicio: p.inicio,
      fim: p.fim,
      duracao: p.duracaoHoras,
      valor: window.Utils.formatarMoeda(p.valor),
    }));

    // Linha de total
    linhas.push({
      inicio: 'TOTAL:',
      fim: '',
      duracao: window.Utils.formatarTotalHoras(prof.totalHoras),
      valor: window.Utils.formatarMoeda(prof.totalValor),
    });

    const totalRowIndex = linhas.length - 1;

    doc.autoTable({
      columns: colunas,
      body: linhas,
      startY: 36,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7,
        cellPadding: { top: 0.5, right: 1.5, bottom: 0.5, left: 1.5 },
        lineColor: [180, 180, 180],
        lineWidth: 0.3,
        textColor: textoPrincipal,
      },
      headStyles: {
        fillColor: roxo,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
        cellPadding: { top: 0.7, right: 1.5, bottom: 0.7, left: 1.5 },
      },
      alternateRowStyles: {
        fillColor: cinzaClaro,
      },
      columnStyles: {
        inicio: { cellWidth: 55 },
        fim: { cellWidth: 55 },
        duracao: { cellWidth: 35, halign: 'center' },
        valor: { cellWidth: 45, halign: 'center' },
      },
      margin: { left: 15, right: 15 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalRowIndex) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = cinzaClaro;
        }
      },
      didDrawPage: () => {
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text(
          `Página ${doc.internal.getCurrentPageInfo().pageNumber}`,
          pageWidth - 15,
          pageHeight - 8,
          { align: 'right' },
        );
      },
    });

    // Rodapé
    const finalY = doc.lastAutoTable.finalY + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text('Relatório gerado automaticamente — MediQuo / Pega Plantão', 15, finalY);

    return doc.output('blob');
  };

  // ─── Relatórios Individuais (ZIP) ────────────────────────

  /**
   * Gera um ZIP contendo um PDF por profissional.
   *
   * @param {DadosRelatorio} dados - Dados parseados.
   * @param {RelatorioCallbacks} cb - Callbacks de UI.
   * @returns {Promise<void>}
   */
  const gerarRelatoriosIndividuais = async (dados, cb) => {
    cb.onBotoes(false);
    const total = dados.profissionais.length;
    cb.onFeedback(`Gerando PDF 1 de ${total}...`, 'info');
    cb.onProgresso(0, total);

    try {
      const zip = new JSZip();

      for (let i = 0; i < total; i += 1) {
        const prof = dados.profissionais[i];
        cb.onFeedback(`Gerando PDF ${i + 1} de ${total} — ${prof.nome}...`, 'info');
        cb.onProgresso(i + 1, total);

        const pdfBlob = gerarPDFIndividual(prof, dados.vigencia);
        const nomePDF = `Relatório individual - Clínica geral - ${prof.nome} - ${dados.vigencia.curta}.pdf`;
        zip.file(nomePDF, pdfBlob);

        // Yield para atualizar UI
        await new Promise((r) => { setTimeout(r, 30); });
      }

      cb.onFeedback('Compactando arquivos...', 'info');
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      saveAs(zipBlob, `Relatórios individuais - Clínica geral - ${dados.vigencia.curta}.zip`);
      cb.onFeedback(`Relatórios individuais gerados com sucesso! (${total} PDFs)`, 'success');
      cb.onProgressoFim();
    } catch (err) {
      console.error(err);
      cb.onFeedback(`Erro ao gerar relatórios: ${err.message}`, 'error');
      cb.onProgressoFim();
    } finally {
      cb.onBotoes(true);
    }
  };

  // ─── Reconstruir dados a partir do backend ───────────────

  /**
   * Reconstroi a estrutura DadosRelatorio a partir dos dados
   * persistidos no backend (formato flat de dados_vigencia).
   *
   * @param {Object} vigenciaInfo - Metadados da vigência do backend.
   * @param {string} vigenciaInfo.inicio - "DD/MM/AAAA"
   * @param {string} vigenciaInfo.fim    - "DD/MM/AAAA"
   * @param {Object[]} registros - Registros flat do dados_vigencia.
   * @param {string} registros[].profissional
   * @param {string} registros[].crm
   * @param {string} registros[].inicio
   * @param {string} registros[].fim
   * @param {string} registros[].duracao_h
   * @param {number} registros[].valor
   * @returns {DadosRelatorio}
   */
  const reconstruirDados = (vigenciaInfo, registros) => {
    const vigencia = {
      inicio: vigenciaInfo.inicio,
      fim: vigenciaInfo.fim,
      raw: `${vigenciaInfo.inicio}~${vigenciaInfo.fim}`,
      curta: window.Utils.formatarVigenciaCurta(`${vigenciaInfo.inicio}~${vigenciaInfo.fim}`),
    };

    /** @type {Object<string, Profissional>} */
    const profMap = {};

    /** @type {string[]} */
    const profOrdem = [];

    registros.forEach((reg) => {
      const chave = `${reg.profissional}|${reg.crm}`;
      if (!profMap[chave]) {
        profMap[chave] = {
          nome: reg.profissional,
          crm: reg.crm,
          plantoes: [],
          totalPlantoes: 0,
          totalHoras: 0,
          totalValor: 0,
        };
        profOrdem.push(chave);
      }

      const duracaoHoras = window.Utils.duracaoParaHorasDecimal(reg.duracao_h);
      profMap[chave].plantoes.push({
        inicio: window.Utils.normalizarDataHora(reg.inicio),
        fim: window.Utils.normalizarDataHora(reg.fim),
        duracaoStr: window.Utils.normalizarDuracao(reg.duracao_h),
        duracaoHoras,
        valor: reg.valor,
        tipo: reg.tipo || 'Normal',
      });
    });

    const profissionais = profOrdem.map((chave) => {
      const prof = profMap[chave];
      let somaHoras = 0;
      let somaValor = 0;
      prof.plantoes.forEach((p) => {
        somaHoras += p.duracaoHoras;
        somaValor += p.valor;
      });
      prof.totalPlantoes = prof.plantoes.length;
      prof.totalHoras = somaHoras;
      prof.totalValor = somaValor;
      return prof;
    });

    let totalGeralPlantoes = 0;
    let totalGeralHoras = 0;
    let totalGeralValor = 0;
    profissionais.forEach((p) => {
      totalGeralPlantoes += p.totalPlantoes;
      totalGeralHoras += p.totalHoras;
      totalGeralValor += p.totalValor;
    });

    return {
      vigencia,
      profissionais,
      totalGeral: {
        plantoes: totalGeralPlantoes,
        horas: totalGeralHoras,
        valor: totalGeralValor,
      },
    };
  };

  // ─── Serializar para envio ao backend ────────────────────

  /**
   * Converte DadosRelatorio em array flat para persistência.
   * Formato: cada plantão vira um registro com profissional e crm.
   *
   * @param {DadosRelatorio} dados - Dados parseados.
   * @returns {Object[]} Registros flat para dados_vigencia.
   */
  const serializarParaBackend = (dados) => {
    /** @type {Object[]} */
    const registros = [];

    dados.profissionais.forEach((prof) => {
      prof.plantoes.forEach((pl) => {
        registros.push({
          profissional: prof.nome,
          crm: prof.crm,
          inicio: pl.inicio,
          fim: pl.fim,
          duracao_h: pl.duracaoStr,
          valor: pl.valor,
          tipo: pl.tipo || 'Normal',
        });
      });
    });

    return registros;
  };

  window.Relatorios = {
    parsearPlanilha,
    gerarRelatorioPorDia,
    gerarRelatorioPorProfissional,
    gerarRelatoriosIndividuais,
    reconstruirDados,
    serializarParaBackend,
  };
})();
