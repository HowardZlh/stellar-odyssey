# R5-1 星系公版源影像（仅供离线烘焙，不进 public/、不随构建分发）

来源：DSS2 彩色合成（STScI Digitized Sky Survey 2；HiPS 数据集 `CDS/P/DSS2/color`），
经 CDS hips2fits 影像服务切取（TAN 投影、北上东左、目标居中）。
IMPROVEMENT_REQUIREMENTS_5 §0.4 数据源表登记行："M31/M33/LMC/SMC 影像 …… DSS2 彩色合成"。

授权登记（附录 A §2）：DSS 基于 AAO/ROE/Caltech 摄影底片数字化数据
（© AAO/ROE/Caltech/STScI），许可科学与教育用途使用并要求署名；
本项目**不分发源图**，仅分发烘焙产物（256×256 权重图 + 512px 远景贴图），
产物 meta 逐一登记 source/license/credit，应用内署名呈现于星系信息面板
数据来源行（`GALAXY_STRUCTURE_SOURCE_ZH`）。

下载 URL（检索于 2026-07-30；`npm run bake:data -- --fetch-galaxy-images` 可重拉）：

| 文件 | URL |
|---|---|
| m31-dss2.png | https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&format=png&projection=TAN&width=1024&height=1024&object=M31&fov=4.0 |
| m33-dss2.png | https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&format=png&projection=TAN&width=1024&height=1024&object=M33&fov=1.5 |
| lmc-dss2.png | https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&format=png&projection=TAN&width=1024&height=1024&object=LMC&fov=12.0 |
| smc-dss2.png | https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&format=png&projection=TAN&width=1024&height=1024&object=SMC&fov=6.0 |

画面污染源登记（烘焙时按天球坐标圆形遮罩 + 宿主径向剖面填充，
遮罩清单见 `scripts/bake-data/galaxyMaps.ts` 配置表）：
- M31 画面含伴系 M32（RA 10.6743° Dec +40.8652°）与 M110（RA 10.0921° Dec +41.6853°）——
  应用内两伴系为独立天体渲染，须自 M31 权重图/贴图中移除；
- SMC 画面含银河系前景球状星团 47 Tuc（NGC 104，RA 6.0224° Dec −72.0814°）
  与 NGC 362（RA 15.8094° Dec −70.8489°）。
