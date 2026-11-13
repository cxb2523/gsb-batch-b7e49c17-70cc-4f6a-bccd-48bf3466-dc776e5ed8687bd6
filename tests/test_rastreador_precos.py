# -*- coding: utf-8 -*-
"""
Testes offline do rastreador de preços da Steam.

Nenhum teste aqui acessa rede real: todas as chamadas de HTTP
(Steam e Telegram) são substituídas por objetos falsos, e os
arquivos de dados vivem em diretórios temporários isolados.

Execução (a partir da raiz do repositório):
    python -m unittest discover -s tests -v
ou:
    python tests/test_rastreador_precos.py
"""

import json
import os
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

# Garante que o pacote em teste seja encontrado mesmo se o suite for
# executado de outro diretório.
RAIZ_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if RAIZ_REPO not in sys.path:
    sys.path.insert(0, RAIZ_REPO)

import rastreador_precos as rp  # noqa: E402


class RespostaFalsa:
    """Imita o objeto de resposta do urllib (suporta read/close)."""

    def __init__(self, conteudo):
        if isinstance(conteudo, str):
            conteudo = conteudo.encode("utf-8")
        self._conteudo = conteudo
        self.fechada = False

    def read(self):
        return self._conteudo

    def close(self):
        self.fechada = True


def resposta_steam(app_id, nome, preco_final):
    """Monta uma resposta bem-sucedida da API appdetails da Steam."""
    return RespostaFalsa(json.dumps({
        str(app_id): {
            "success": True,
            "data": {
                "name": nome,
                "price_overview": {"final": preco_final},
            },
        }
    }))


class GerenciadorTemp:
    """Cria um diretório temporário e entra nele para cada teste."""

    def iniciar(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cwd_original = os.getcwd()
        os.chdir(self.temp.name)

    def finalizar(self):
        os.chdir(self.cwd_original)
        self.temp.cleanup()

    def escrever(self, nome_arquivo, conteudo):
        with open(os.path.join(self.temp.name, nome_arquivo), "w",
                  encoding="utf-8") as arquivo:
            arquivo.write(conteudo)

    def ler_json(self, nome_arquivo):
        with open(os.path.join(self.temp.name, nome_arquivo), "r",
                  encoding="utf-8") as arquivo:
            return json.load(arquivo)


class CasoBase(unittest.TestCase):
    def setUp(self):
        self.base = GerenciadorTemp()
        self.base.iniciar()
        # Nenhuma pausa real entre requisições durante os testes.
        self.sleep_patcher = mock.patch.object(rp.time, "sleep", return_value=None)
        self.sleep_patcher.start()

    def tearDown(self):
        self.sleep_patcher.stop()
        self.base.finalizar()


class TesteBuscarPreco(CasoBase):
    """Cobrir as falhas de busca de forma isolada, sem lançar exceção."""

    def test_erro_de_rede_devolve_none(self):
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            side_effect=urllib.error.URLError("simulação de queda de rede")
        ):
            with self.assertLogs(level="WARNING") as logs:
                resultado = rp.buscar_preco(413150)
        self.assertIsNone(resultado)
        self.assertTrue(any("Falha de rede" in linha for linha in logs.output))

    def test_json_invalido_devolve_none(self):
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            return_value=RespostaFalsa("<<isso nao e json>>")
        ):
            with self.assertLogs(level="WARNING") as logs:
                resultado = rp.buscar_preco(413150)
        self.assertIsNone(resultado)
        self.assertTrue(any("JSON válido" in linha for linha in logs.output))

    def test_app_id_ausente_na_resposta_devolve_none(self):
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            return_value=RespostaFalsa(json.dumps({"999": {"success": False}}))
        ):
            with self.assertLogs(level="WARNING"):
                resultado = rp.buscar_preco(413150)
        self.assertIsNone(resultado)

    def test_resposta_sem_data_devolve_none(self):
        resposta = RespostaFalsa(json.dumps(
            {"413150": {"success": False}}  # sem o campo "data"
        ))
        with mock.patch.object(rp.urllib.request, "urlopen",
                               return_value=resposta):
            with self.assertLogs(level="WARNING") as logs:
                resultado = rp.buscar_preco(413150)
        self.assertIsNone(resultado)
        self.assertTrue(any("sem 'data'" in linha for linha in logs.output))

    def test_sucesso_devolve_jogo_com_preco(self):
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            return_value=resposta_steam(413150, "Stardew Valley", 2499)
        ):
            resultado = rp.buscar_preco(413150)
        self.assertEqual(
            resultado, {"jogo": "Stardew Valley", "preco": 24.99}
        )

    def test_buscar_nome_jogo_tolera_falha_de_rede(self):
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            side_effect=urllib.error.URLError("sem rede")
        ):
            self.assertIsNone(rp.buscar_nome_jogo(413150))


class TesteVarredura(CasoBase):
    """Caminhos principais da rodada: sucesso, falha parcial e falha total."""

    def _urlopen_falso(self, roteamento):
        """urlopen falso que roteia por app_id; falta de rota = falha de rede."""
        def falso(url, *args, **kwargs):
            for app_id, comportamento in roteamento.items():
                if f"appids={app_id}" in url:
                    if isinstance(comportamento, Exception):
                        raise comportamento
                    return comportamento
            raise urllib.error.URLError(f"app_id sem rota de teste: {url}")
        return falso

    def test_sucesso_compara_notifica_e_grava_historico(self):
        self.base.escrever(
            "historico.json",
            json.dumps({"Stardew Valley": [24.99]})
        )
        historico = rp.carregar_historico()
        jogos = [
            {"app_id": 413150, "nome": "Stardew Valley"},
            {"app_id": 730, "nome": "Counter-Strike 2"},
        ]
        roteamento = {
            413150: resposta_steam(413150, "Stardew Valley", 1749),  # queda
            730: resposta_steam(730, "Counter-Strike 2", 999),       # jogo novo
        }
        with mock.patch.object(rp.urllib.request, "urlopen",
                               side_effect=self._urlopen_falso(roteamento)):
            with mock.patch.object(rp, "enviar_notificacao") as notificar:
                contagem = rp.rodar_varredura(jogos, historico)

        self.assertEqual(contagem, {"total": 2, "sucesso": 2, "falha": 0})
        # Uma notificação de queda (Stardew) e nenhuma para jogo novo (sem anterior).
        self.assertEqual(notificar.call_count, 1)
        self.assertIn("queda", notificar.call_args[0][0])

        gravado = self.base.ler_json("historico.json")
        self.assertEqual(gravado["Stardew Valley"], [24.99, 17.49])
        self.assertEqual(gravado["Counter-Strike 2"], [9.99])

    def test_falha_em_um_jogo_nao_interrompe_os_demais(self):
        historico = {}
        jogos = [
            {"app_id": 570, "nome": "Dota 2"},        # vai falhar
            {"app_id": 413150, "nome": "Stardew Valley"},  # vai funcionar
        ]
        roteamento = {
            570: urllib.error.URLError("falha simulada"),
            413150: resposta_steam(413150, "Stardew Valley", 2499),
        }
        with mock.patch.object(rp.urllib.request, "urlopen",
                               side_effect=self._urlopen_falso(roteamento)):
            with mock.patch.object(rp, "enviar_notificacao"):
                with self.assertLogs(level="WARNING") as logs:
                    contagem = rp.rodar_varredura(jogos, historico)

        self.assertEqual(contagem, {"total": 2, "sucesso": 1, "falha": 1})
        # O jogo que falhou não foi parar no histórico; o bem-sucedido sim.
        gravado = self.base.ler_json("historico.json")
        self.assertNotIn("Dota 2", gravado)
        self.assertEqual(gravado["Stardew Valley"], [24.99])
        self.assertTrue(
            any("570" in linha and "sem preço válido" in linha
                for linha in logs.output)
        )

    def test_todas_as_falhas_mantem_historico_existente(self):
        historico_original = {"Jogo Antigo": [10.0, 12.5]}
        self.base.escrever("historico.json", json.dumps(historico_original))
        historico = rp.carregar_historico()
        jogos = [
            {"app_id": 1, "nome": "Um"},
            {"app_id": 2, "nome": "Dois"},
        ]
        roteamento = {
            1: urllib.error.URLError("rede 1"),
            2: RespostaFalsa("resposta quebrada"),
        }
        with mock.patch.object(rp.urllib.request, "urlopen",
                               side_effect=self._urlopen_falso(roteamento)):
            with self.assertLogs(level="WARNING") as logs:
                contagem = rp.rodar_varredura(jogos, historico)

        self.assertEqual(contagem, {"total": 2, "sucesso": 0, "falha": 2})
        self.assertTrue(
            any("Nenhum jogo retornou um preço válido" in linha
                for linha in logs.output)
        )
        # O arquivo existe e guarda exatamente os dados anteriores.
        self.assertTrue(os.path.exists("historico.json"))
        self.assertEqual(self.base.ler_json("historico.json"),
                         historico_original)

    def test_falha_de_notificacao_nao_impede_historico(self):
        historico = {"Stardew Valley": [24.99]}
        jogos = [{"app_id": 413150, "nome": "Stardew Valley"}]
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            return_value=resposta_steam(413150, "Stardew Valley", 1749)
        ):
            with mock.patch.object(
                rp, "enviar_notificacao",
                side_effect=urllib.error.URLError("telegram fora do ar")
            ):
                with self.assertLogs(level="ERROR"):
                    contagem = rp.rodar_varredura(jogos, historico)

        self.assertEqual(contagem["sucesso"], 1)
        self.assertEqual(
            self.base.ler_json("historico.json")["Stardew Valley"],
            [24.99, 17.49]
        )


class TesteHistoricoRobusto(CasoBase):
    """historico.json precisa sobreviver a ausência e a conteúdo corrompido."""

    def test_arquivo_ausente_vira_historico_vazio(self):
        with self.assertLogs(level="WARNING"):
            self.assertEqual(rp.carregar_historico(), {})

    def test_json_invalido_preserva_original_em_backup(self):
        conteudo_estragado = "{isso nao e json valido"
        self.base.escrever("historico.json", conteudo_estragado)

        with self.assertLogs(level="ERROR") as logs:
            historico = rp.carregar_historico()

        self.assertEqual(historico, {})
        # O original não foi sobrescrito: virou backup com o mesmo conteúdo.
        backups = [nome for nome in os.listdir(self.base.temp.name)
                   if nome.startswith("historico.json.corrompido.")]
        self.assertEqual(len(backups), 1)
        with open(os.path.join(self.base.temp.name, backups[0]),
                  encoding="utf-8") as arquivo:
            self.assertEqual(arquivo.read(), conteudo_estragado)
        # Nenhum historico.json novo foi criado silenciosamente ainda.
        self.assertFalse(os.path.exists("historico.json"))
        self.assertTrue(any("JSON válido" in linha for linha in logs.output))

        # A rodada segue normalmente e grava um arquivo novo e válido.
        self.assertTrue(rp.salvar_historico(historico))
        self.assertEqual(self.base.ler_json("historico.json"), {})

    def test_top_level_nao_objeto_e_rejeitado_com_backup(self):
        self.base.escrever("historico.json", json.dumps([1, 2, 3]))
        with self.assertLogs(level="ERROR") as logs:
            historico = rp.carregar_historico()
        self.assertEqual(historico, {})
        self.assertTrue(
            any("não é um objeto" in linha for linha in logs.output)
        )
        backups = [nome for nome in os.listdir(self.base.temp.name)
                   if nome.startswith("historico.json.corrompido.")]
        self.assertEqual(len(backups), 1)

    def test_valor_de_um_jogo_nao_numerico_vira_sem_historico(self):
        historico = {
            "Jogo Bom": [10.0, 12.0],
            "Jogo Estranho": "nao sou uma lista",
            "Lista Suja": [10.0, "vinte", 30.0],
        }
        with self.assertLogs(level="WARNING") as logs:
            self.assertIsNone(rp.buscar_anterior(historico, "Jogo Estranho"))
            self.assertIsNone(rp.buscar_menor_preco(historico, "Jogo Estranho"))
            self.assertIsNone(rp.buscar_anterior(historico, "Lista Suja"))
        # O jogo bom continua funcionando normalmente.
        self.assertEqual(rp.buscar_anterior(historico, "Jogo Bom"), 12.0)
        self.assertEqual(rp.buscar_menor_preco(historico, "Jogo Bom"), 10.0)
        self.assertEqual(len(logs.output), 3)

    def test_serie_invalida_e_reiniciada_na_varredura(self):
        historico = {"Stardew Valley": ["lixo", "mais lixo"]}
        jogos = [{"app_id": 413150, "nome": "Stardew Valley"}]
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            return_value=resposta_steam(413150, "Stardew Valley", 2499)
        ):
            with mock.patch.object(rp, "enviar_notificacao"):
                with self.assertLogs(level="WARNING"):
                    rp.rodar_varredura(jogos, historico)
        self.assertEqual(
            self.base.ler_json("historico.json")["Stardew Valley"],
            [24.99]
        )


class TesteComandos(CasoBase):
    """/add e /remove: duplicados, ausentes e argumentos inválidos."""

    def setUp(self):
        super().setUp()
        self.jogos = [{"app_id": 730, "nome": "Counter-Strike 2"}]
        self.base.escrever(
            "jogos_monitorados.json", json.dumps(self.jogos, ensure_ascii=False)
        )

    def test_adicionar_duplicado_e_recusado(self):
        with mock.patch.object(rp, "salvar_jogos_monitorados") as salvar:
            with self.assertLogs(level="WARNING"):
                adicionou = rp.adicionar_jogo(self.jogos, 730, "Counter-Strike 2")
        self.assertFalse(adicionou)
        salvar.assert_not_called()
        self.assertEqual(len(self.jogos), 1)

    def test_adicionar_novo_salva_imediatamente(self):
        with mock.patch.object(
            rp.urllib.request, "urlopen",
            return_value=resposta_steam(413150, "Stardew Valley", 2499)
        ):
            nome = rp.buscar_nome_jogo(413150)
            self.assertTrue(rp.adicionar_jogo(self.jogos, 413150, nome))

        gravado = self.base.ler_json("jogos_monitorados.json")
        self.assertEqual(len(gravado), 2)
        self.assertIn({"app_id": 413150, "nome": "Stardew Valley"}, gravado)

    def test_remover_inexistente_nao_altera_lista(self):
        with mock.patch.object(rp, "salvar_jogos_monitorados") as salvar:
            with self.assertLogs(level="WARNING"):
                removido = rp.remover_jogo(self.jogos, 999)
        self.assertIsNone(removido)
        salvar.assert_not_called()
        self.assertEqual(
            self.base.ler_json("jogos_monitorados.json"), self.jogos
        )

    def test_remover_existente_salva_imediatamente(self):
        removido = rp.remover_jogo(self.jogos, 730)
        self.assertEqual(removido, {"app_id": 730, "nome": "Counter-Strike 2"})
        self.assertEqual(self.base.ler_json("jogos_monitorados.json"), [])

    def test_interpretar_app_id_argumentos_invalidos(self):
        app_id, erro = rp._interpretar_app_id(["/add"], "/add")
        self.assertIsNone(app_id)
        self.assertIn("/add 730", erro)

        app_id, erro = rp._interpretar_app_id(["/add", "abc"], "/add")
        self.assertIsNone(app_id)
        self.assertIn("inteiro", erro)

        app_id, erro = rp._interpretar_app_id(["/remove", "  42 "], "/remove")
        self.assertIsNone(erro)
        self.assertEqual(app_id, 42)

    def _telegram_falso(self, mensagens, nomes_steam=None):
        """urlopen falso combinando getUpdates do Telegram e appdetails."""
        nomes_steam = nomes_steam or {}

        def falso(url, *args, **kwargs):
            if "api.telegram.org" in url and "getUpdates" in url:
                return RespostaFalsa(json.dumps({"ok": True, "result": mensagens}))
            if "api.telegram.org" in url and "sendMessage" in url:
                return RespostaFalsa(json.dumps({"ok": True}))
            if "store.steampowered.com" in url:
                for app_id, nome in nomes_steam.items():
                    if f"appids={app_id}" in url:
                        return resposta_steam(app_id, nome, 2499)
            raise AssertionError(f"URL inesperada em teste: {url}")

        return falso

    def test_comando_add_duplicado_via_telegram(self):
        mensagens = [{"update_id": 1, "message": {"text": "/add 730"}}]
        with mock.patch.object(rp, "buscar_mensagens_novas",
                               return_value=mensagens):
            with mock.patch.object(rp, "buscar_nome_jogo") as buscar_nome, \
                 mock.patch.object(rp, "salvar_jogos_monitorados") as salvar, \
                 self.assertLogs(level="WARNING"):
                rp.processar_comandos(self.jogos)
        # Duplicado é recusado antes de qualquer chamada de rede.
        buscar_nome.assert_not_called()
        salvar.assert_not_called()
        self.assertEqual(len(self.jogos), 1)
        self.assertEqual(
            self.base.ler_json("telegram_offset.json"),
            {"ultimo_update_id": 1}
        )

    def test_comando_add_sem_parametro_e_nao_inteiro(self):
        mensagens = [
            {"update_id": 1, "message": {"text": "/add"}},
            {"update_id": 2, "message": {"text": "/add abc"}},
            {"update_id": 3, "message": {"text": "/add 730 xyz"}},  # 730 já existe
        ]
        with mock.patch.object(rp, "buscar_mensagens_novas",
                               return_value=mensagens):
            with mock.patch.object(rp, "salvar_jogos_monitorados") as salvar, \
                 self.assertLogs(level="WARNING"):
                # Não deve lançar exceção.
                rp.processar_comandos(self.jogos)
        salvar.assert_not_called()
        self.assertEqual(len(self.jogos), 1)
        self.assertEqual(
            self.base.ler_json("telegram_offset.json"),
            {"ultimo_update_id": 3}
        )

    def test_comando_remove_inexistente_via_telegram(self):
        mensagens = [{"update_id": 7, "message": {"text": "/remove 999"}}]
        with mock.patch.object(rp, "buscar_mensagens_novas",
                               return_value=mensagens):
            with mock.patch.object(rp, "salvar_jogos_monitorados") as salvar, \
                 self.assertLogs(level="WARNING"):
                rp.processar_comandos(self.jogos)
        salvar.assert_not_called()
        self.assertEqual(len(self.jogos), 1)
        self.assertEqual(
            self.base.ler_json("telegram_offset.json"),
            {"ultimo_update_id": 7}
        )

    def test_fluxo_completo_add_list_remove_offline(self):
        # Credencial fictícia só para carregar_config_telegram funcionar.
        self.base.escrever(
            "config_telegram.json",
            json.dumps({"token": "falso", "chat_id": 123})
        )
        mensagens = [
            {"update_id": 1, "message": {"text": "/add 413150"}},
            {"update_id": 2, "message": {"text": "/list"}},
            {"update_id": 3, "message": {"text": "/remove 730"}},
        ]
        urlopen_falso = self._telegram_falso(
            mensagens, nomes_steam={413150: "Stardew Valley"}
        )
        with mock.patch.object(rp.urllib.request, "urlopen",
                               side_effect=urlopen_falso):
            rp.processar_comandos(self.jogos)

        gravado = self.base.ler_json("jogos_monitorados.json")
        self.assertEqual(gravado, [
            {"app_id": 413150, "nome": "Stardew Valley"}
        ])
        self.assertEqual(
            self.base.ler_json("telegram_offset.json"),
            {"ultimo_update_id": 3}
        )

    def test_falha_ao_buscar_mensagens_nao_derruba_o_programa(self):
        with mock.patch.object(
            rp, "buscar_mensagens_novas",
            side_effect=urllib.error.URLError("telegram indisponível")
        ):
            with self.assertLogs(level="ERROR"):
                # Apenas retorna, sem levantar exceção.
                rp.processar_comandos(self.jogos)
        self.assertEqual(len(self.jogos), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
