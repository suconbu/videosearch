(function() {

Vue.component("list-item", {
    props: ["liclass", "imgclass", "data", "text", "subtext", "icon", "click", "highlighter"],
    template: `
        <li v-bind:class="liclass" @click="click(data)">
            <img v-bind:class="imgclass" v-if="icon" :src="icon">
            <div v-html="highlighter ? highlighter(text) : text" />
            <div class="grayout-text" v-if="subtext" v-html="subtext" />
        </li>
    `
});

// 品目リスト更新時の一回分の増加数(0なら一回で全部表示)
const ARTICLE_TRANSFER_UNIT = 50;

// お弁当屋
const SUPPORTED_UNITS = [
    { id: "dondon", name: "どんどん", file: "data/dondon/menu.json" }
];

function getQueryVars() {
    const vars = {}
    uri = decodeURI(window.location.search);
    for (let entry of uri.slice(1).split("&")) {
        keyValue = entry.split("=");
        vars[keyValue[0]] = keyValue[1]
    }
    return vars;
}

function getIndex(articles, article, offset, wraparound) {
    let index = articles.findIndex(a => a === article);
    if (0 <= index) {
        index += offset;
        if (wraparound) {
            index =
                (index < 0) ? (articles.length + index) :
                (articles.length <= index) ? (index - articles.length) :
                index;
        } else {
            index =
                (index < 0) ? 0 :
                (articles.length <= index) ? (articles.length - 1) :
                index;
        }
    }
    return index;
}

function getMatchedArticles(articles, keyword) {
    let matched = [];
    if (keyword) {
        keyword = keyword.toLowerCase()
        matched = matched.concat(articles.filter(article => 
            article.name.toLowerCase() === keyword ||
            (article.nameKana && article.nameKana === keyword) ||
            (article.nameRoman && article.nameRoman === keyword)
            ));
        matched = matched.concat(articles.filter(article => 
            matched.indexOf(article) === -1 && (
                article.name.toLowerCase().startsWith(keyword) ||
                (article.nameKana && article.nameKana.startsWith(keyword)) ||
                (article.nameRoman && article.nameRoman.startsWith(keyword))
            )));
        matched = matched.concat(articles.filter(article => 
            matched.indexOf(article) === -1 && (
                article.name.toLowerCase().indexOf(keyword) !== -1 ||
                (article.nameKana && article.nameKana.indexOf(keyword) !== -1) ||
                (article.nameRoman && article.nameRoman.indexOf(keyword) !== -1)
            )));
    } else {
        matched = articles;
    }
    return matched;
}

function requestFeed(unit) {
    const request = new XMLHttpRequest();
    request.open('GET', unit.file);
    request.responseType = 'json';
    request.send();
    request.onload = function() {
        appState.load(request.response, unit);
        app = app || createApp(appState);
        if (appState.initialArticleKeyword) {
            app.$data.articleKeyword = appState.initialArticleKeyword;
            appState.initialArticleKeyword = null;
        }
    }
}

class Article {
    constructor(item, data_dir) {
        this.id = item.id;
        this.name = item.title;
        if (item.image) {
            if (item.image.startsWith("http")) {
                this.icon = item.image;
            } else {
                this.icon = data_dir + "/" + item.image;
            }
        } else {
            this.icon = "img/noimage.png"
        }
        this.price = item._price;
        this.nameKana = item._title_kana;
        this.nameRoman = kana2roman.convert(item._title_kana, true);
        this.note = item._note;
    }
}

class AppState {
    constructor() {
        this.allUnitsById = {}
        SUPPORTED_UNITS.forEach(unit => this.allUnitsById[unit.id] = unit);
        // this.commonCategoriesById = {};
        // for (let commonCategory of COMMON_CATEGORIES) {
        //     this.commonCategoriesById[commonCategory.id] = Object.assign({}, commonCategory);
        // }
        this.selectedUnit = null;
        this.unitPopupVisible = false;
        this.initialArticleKeyword = null;
        this.reset();
    }
    reset() {
        this.timeoutId = 0;
        this.articleKeyword = "";
        this.unitKeyword = "";
        this.placeholder = "";
        this.categoriesById = {};
        this.allArticles = [];
        this.waitingArticles = [];
        this.visibleArticles = [];
        this.selectedArticle = null;
        // this.legendCategoryIds = [];
        this.homepageUrl = null;
        this.updatedAt = null;
    }
    load(menufeed, unit) {
        this.reset();
        this.homepageUrl = menufeed.home_page_url;
        this.updatedAt = Math.max(menufeed.items.map(x => new Date(x.date_modified)));
        this.allArticles = [];
        const data_dir = `data/${unit.id}`;
        menufeed.items.forEach(item => {
            this.allArticles.push(new Article(item, data_dir));
        })
        // this.allArticles = menufeed.items;
        // this.allArticles.forEach((article) => {
        //     article.nameRoman = kana2roman.convert(article._nameKana, true);
        // });

        const index = Math.floor(Math.random() * this.allArticles.length);
        this.placeholder = "例：" + this.allArticles[index].name;
    }
}

function createApp(data) {
    return new Vue({
        el: "#app",
        data: data,
        watch: {
            articleKeyword: function(newValue, oldValue) {
                this.articleKeyword = newValue;
                // https://s8a.jp/javascript-escape-regexp
                escaped = this.articleKeyword.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
                this.articleKeywordRegex = new RegExp(escaped, "ig");
                this.changeArticles(getMatchedArticles(this.allArticles, this.articleKeyword));
                this.updateQueryString();
            },
            allArticles: function(newValue, oldValue) {
                this.changeArticles(this.allArticles)
            }
        },
        computed: {
            menufeedAvailable() {
                return 0 < this.allArticles.length;
            },
            topLevelCategories() {
                return Object.keys(this.categoriesById).
                    filter(id => this.categoriesById[id].isTopLevel).
                    map(id => this.categoriesById[id]);
            }
        },
        created() {
            this.changeArticles(this.allArticles);
        },
        methods: {
            getCategoryOrDefault(categoryId, defaultId="unknown") {
                return this.categoriesById[categoryId] || this.commonCategoriesById[defaultId];
            },
            changeArticles(articles) {
                this.waitingArticles = articles.slice();
                this.visibleArticles = [];
                if (this.timeoutId) {
                    clearTimeout(this.timeoutId);
                }
                this.transferArticles(ARTICLE_TRANSFER_UNIT);
            },
            transferArticles(count) {
                count = (count <= 0) ? this.waitingArticles.length : count;
                const articles = this.waitingArticles.splice(0, count);
                this.visibleArticles = this.visibleArticles.concat(articles);
                if (0 < this.waitingArticles.length) {
                    this.timeoutId = setTimeout(() => this.transferArticles(count), 10)
                } else {
                    this.timeoutId = 0;
                }
            },
            articleClicked(article) {
                this.selectedArticle = article;
                this.$nextTick(function() {
                    this.$refs.popupWindow.focus();
                })
            },
            articlePopupKeydown(e) {
                if (e.key == "ArrowUp" || e.key == "ArrowLeft") {
                    this.moveArticleSelection(-1, true);
                } else if (e.key == "ArrowDown" || e.key == "ArrowRight") {
                    this.moveArticleSelection(+1, true);
                } else if (e.key == "PageUp") {
                    this.moveArticleSelection(-10, false);
                } else if (e.key == "PageDown") {
                    this.moveArticleSelection(+10, false);
                } else if (e.key == "Home") {
                    this.moveArticleSelection(-this.allArticles.length, false);
                } else if (e.key == "End") {
                    this.moveArticleSelection(+this.allArticles.length, false);
                } else if (e.key == "Enter" || e.key == "Escape") {
                    this.closeArticlePopup();
                }
            },
            moveArticleSelection(offset, wraparound) {
                if (0 < this.visibleArticles.length) {
                    const nextIndex = getIndex(this.visibleArticles, this.selectedArticle, offset, wraparound);
                    if (nextIndex !== -1) {
                        this.selectedArticle = this.visibleArticles[nextIndex];
                        this.$refs.article[nextIndex].$el.scrollIntoView(false);
                    }
                }                    
            },
            closeArticlePopup() {
                this.selectedArticle = null;
            },
            dummy(e) {
                e.stopPropagation();
            },
            getKeywordHighlighted(text) {
                return this.articleKeyword ? text.replace(this.articleKeywordRegex, match => "<span class='keyword-highlight'>" + match + "</span>") : text;
            },
            openUnitPopup() {
                this.unitPopupVisible = true;
            },
            closeUnitPopup() {
                if (this.selectedUnit) {
                    this.unitPopupVisible = false;
                }
            },
            popupUnitClicked(unit) {
                this.unitPopupVisible = false;
                this.selectedUnit = unit;
                requestFeed(unit);
                this.updateQueryString();
            },
            updateQueryString() {
                q = [];
                if (this.selectedUnit) {
                    q.push(`unit=${this.selectedUnit.id}`);
                }
                if (this.articleKeyword) {
                    q.push(`keyword=${this.articleKeyword}`);
                }
                history.replaceState("", "", "?" + q.join("&"));
            }
        }
    });
}

let app = null;
const appState = new AppState();

const vars = getQueryVars();
if (vars.unit) {
    appState.selectedUnit = appState.allUnitsById[vars.unit];
}
if (vars.keyword) {
    appState.initialArticleKeyword = vars.keyword;
}

if (appState.selectedUnit) {
    requestFeed(appState.selectedUnit);
} else {
    app = createApp(appState);
    appState.unitPopupVisible = true;
}

})();
