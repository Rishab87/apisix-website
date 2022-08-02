import { stat, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'path';
import Listr from 'listr';
import matter from 'gray-matter';
import { remark } from 'remark';
import mdx from 'remark-mdx';
import remarkComment from 'remark-comment';
import { visit } from 'unist-util-visit';
import { format } from 'date-fns';

const configs = ['../blog/en/config/picked-posts.json', '../blog/zh/config/picked-posts.json'];

const parser = remark().use(mdx).use(remarkComment);
const isImage = (node) => node.type === 'image';
const isHeading = (node) => node.type === 'heading';
const isParagraph = (node) => node.type === 'paragraph';
const isText = (node) => node.type === 'text';

function toText(node) {
  let excerpt = '';
  visit(node, ['text', 'inlineCode'], (child, index, parent) => {
    if (parent?.type !== 'linkReference') {
      excerpt += child.value;
    }
  });
  return excerpt;
}

function createExcerpt(fileString) {
  const mdast = parser.parse(fileString);
  let excerpt = '';
  visit(mdast, ['paragraph', 'heading', 'image'], (node) => {
    const isAdmonitionFence =
      isParagraph(node) && isText(node.children[0]) && node.children[0].value.startsWith(':::');
    const isMainHeading = isHeading(node) && node.depth === 1;
    if (isAdmonitionFence || isMainHeading) {
      return true;
    }
    if (isImage(node)) {
      if (node.alt) {
        excerpt = node.alt;
        return false;
      }
    } else if (isParagraph(node)) {
      excerpt = toText(node);
    }
    if (excerpt) {
      return false;
    }
    return true;
  });

  return excerpt || undefined;
}

const tasks = new Listr([
  {
    title: `Check picked blog config files exist`,
    task: () =>
      Promise.all(
        configs.map((f) =>
          stat(f).then((stat) =>
            stat.isFile() ? Promise.resolve() : Promise.reject(new Error(`${f} is not a file`))
          )
        )
      ),
  },
  {
    title: `Generate picked blog info files`,
    task: () =>
      new Listr(
        configs.map((config) => ({
          title: `picking from ${config}`,
          task: () =>
            readFile(config, 'utf8')
              .then((json) => JSON.parse(json))
              .then((paths) =>
                Promise.all(
                  paths.map((path) =>
                    readFile(`../${path}`, 'utf8').then((content) => {
                      const { data, content: c } = matter(content);
                      const locale = path.includes('/zh/blog') ? 'zh-CN' : 'en-US';
                      const rawDate = new Date(
                        path.substring('blog/en/blog/'.length, 'blog/en/blog/2022/07/30'.length)
                      );
                      const date = rawDate.toISOString();
                      const formattedDate = format(
                        rawDate,
                        locale === 'zh-CN' ? 'yyyy年MM月d日' : 'MMM dd, yyyy'
                      );
                      return {
                        ...data,
                        authors: data.authors.map((v) => {
                          if (v.image_url) {
                            v.imageURL = v.image_url;
                            delete v.image_url;
                          }
                          return v;
                        }),
                        tags:
                          data?.tags.map((v) => ({
                            label: v,
                            permalink:
                              locale === 'zh-CN' ? '/zh/blog/tags/' + v : '/blog/tags/' + v,
                          })) || [],
                        summary: createExcerpt(c),
                        permalink: path
                          .substring(locale === 'zh-CN' ? 'blog'.length : 'blog/en'.length)
                          .slice(0, -'.md'.length),
                        date,
                        formattedDate,
                      };
                    })
                  )
                )
                  .then(
                    (matters) =>
                      `/*THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.*/\nconst config = ${JSON.stringify(
                        matters,
                        null,
                        2
                      )};\nmodule.exports = config;`
                  )
                  .then((content) =>
                    writeFile(join(dirname(config), 'picked-posts-info.js'), content, 'utf-8')
                  )
              ),
        })),
        { concurrent: configs.length }
      ),
  },
]);

tasks
  .run()
  .then(() => {
    console.log(`[Finish] Generate picked blog info files`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });