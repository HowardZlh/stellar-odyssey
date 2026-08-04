# 素材许可与数据来源（Attribution）

> 本文完整登记星海奥德赛使用的全部第三方素材与天文数据的来源、许可与处理说明。
> 摘要见 [README 素材许可一节](../README.md#素材许可attribution)。

## 天文星表与巡天数据

`public/data/` 烘焙产物，来源/许可/检索语句登记于各产物 meta 与 `scripts/bake-data/`：

- 昴星团成员星：ESA **Gaia DR3**（Gaia TAP，视差 + 自行共动选星 600 颗，ADQL 查询语句随快照登记）；
- 宇宙大尺度背景：**2MASS 红移巡天 2MRS**（Huchra et al. 2012, ApJS 199, 26，VizieR J/ApJS/199/26，43,488 星系）；
- 星系近观影像图组（M31/M33/LMC/SMC 密度/颜色/尘埃图与远景贴图）：**DSS2 彩色巡天**
  （STScI Digitized Sky Survey / AAO / ROE / Caltech，经 CDS **hips2fits** 服务切取烘焙；
  源图不入库，产物为派生权重图）；
- 恒星物理参数/特殊天体位置：**SIMBAD** 及逐天体文献（Joyce 2020、Kervella 2003、EHT 2019、
  Su et al. 2010、Levine et al. 2006、Piran 2004 等——应用内信息面板"数据来源"行逐项呈现）；
- M13 King profile：Harris 星团目录（1996，2010 版）。

## 行星与太阳纹理

- `public/textures/` 下的行星/月球/太阳表面纹理（2K 底图与 `4k_*` 近观细节层）与土星环纹理来自
  [Solar System Scope Textures](https://www.solarsystemscope.com/textures/)，
  许可协议 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（基于 NASA 观测数据制作）。
  4K 细节层由 SSS 8K 源图本地降采样至 4096×2048（P4）；官方对天王星、海王星、土星环仅提供 2K 源图，
  相应贴图维持 2K。`4k_sun.jpg`（S1 太阳近观层）：SSS 官方"8K"下载实为 4096×2048（与木星/土星情况
  一致，已核实），直接采用。纹理清单与代码内登记见 `src/data/textures.ts`；加载失败时自动降级为程序化纹理
  （`src/components/CelestialBody/proceduralTextures.ts`）。

## 法线贴图

P4 近观立体细节，本仓库由公开高程数据转换生成：

- `4k_earth_normal.jpg`：NASA Earth Observatory
  [GEBCO 全球地形图](https://visibleearth.nasa.gov/images/73934/topography)（公有领域）转换；
- `4k_moon_normal.jpg`：NASA SVS [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720)
  LOLA LDEM 高程数据（公有领域）转换；
- `4k_mars_normal.jpg`：降级路径——无可获取的轻量 MOLA DEM（USGS 全分辨率 11 GB），
  由火星 4K 色彩贴图亮度推导生成。

## 彗核形状

- 彗核形状参数（哈雷 15×8 km 花生形）依据 ESA Giotto 任务观测数据（`src/utils/cometNucleus.ts` 登记）。

## 矮行星真实贴图

P5，公有领域，本地降采样至 2K 底图 2048×1024 + 4K 近观层 4096×2048：

- `2k_pluto.jpg` / `4k_pluto.jpg`：NASA New Horizons LORRI/MVIC
  [全球拼接彩色地图](https://www.nasa.gov/image-feature/pluto-global-color-map)
  （NASA / Johns Hopkins University APL / Southwest Research Institute，公有领域）；
  南纬约 30° 以南为黑色未测绘区（飞掠时处于极夜，科学事实）；
- `2k_ceres.jpg` / `4k_ceres.jpg`：NASA Dawn FC 全球拼接图（USGS Astrogeology
  Ceres_Dawn_FC_DLR_global_20ppd_Oct2015，https://planetarymaps.usgs.gov/mosaic/ 托管，
  NASA / JPL-Caltech / UCLA / MPS / DLR / IDA，公有领域）；
- `4k_pluto_normal.jpg`：USGS Astrogeology
  Pluto_NewHorizons_Global_DEM_300m_Jul2017（公有领域，620 MB 源数据本地转换）；
  未测绘半球置平（与彩色贴图黑色未测绘区一致），测绘区边缘噪声经模糊 +
  梯度钳制抑制（残余粗糙感属源 DEM 立体像对不确定度）；
- `4k_ceres_normal.jpg`：USGS Astrogeology
  Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016（公有领域，467 MB 源数据本地转换）；
- 阋神星/鸟神星/妊神星无探测器实拍表面图，使用基于观测特征（反照率/颜色/光谱）的
  程序化增强纹理，艺术化推测部分登记于 `proceduralTextures.ts` 文件头。

## 人造卫星 glTF 精细模型

P7，`public/models/`，清单与登记见 `src/data/models.ts`：

- `iss.glb`：NASA 3D Resources
  ["International Space Station (ISS) (B)"](https://github.com/nasa/NASA-3D-Resources)
  （公有领域），本地经 gltf-transform 优化（weld/simplify + meshopt 压缩，190 KB / 3.2 万三角形）；
  源模型材质为统一灰色，运行时按网格形态启发式着色（帆板深蓝/桁架银灰/舱体白色，
  基于真实 ISS 外观的艺术化增强，登记于 `satelliteGeometry.ts` 文件头）；
- `hubble.glb`：NASA 3D Resources "Hubble Space Telescope (A)"（公有领域），
  同上优化（168 KB / 5 千三角形）；
- `geo-satellite.glb`：NASA 3D Resources "Tracking and Data Relay Satellites (TDRS) (B)"
  （公有领域，以 TDRS 为原型的静止轨道通信卫星示意），同上优化（305 KB / 1.6 万三角形）；
- 天宫空间站：无 NASA 公版模型且未找到开放许可（CC0/CC BY）社区模型，
  按需求降级为程序化几何组合（T 字三舱构型 + 柔性太阳翼，
  `src/components/CelestialBody/satelliteGeometry.ts`）；
- 全部模型仅近观懒加载（首屏无模型网络请求），加载失败静默降级为程序化几何组合。
