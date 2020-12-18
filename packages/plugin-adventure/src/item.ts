import { Context, isInteger, checkTimer, ParsedArgv, Session, Random, User } from 'koishi'
import { getValue, Shopper, Adventurer, ReadonlyUser, showItemSuggestions } from './utils'
import Event from './event'
import Phase from './phase'
import Rank from './rank'

async function generateItemMap({ args, session, next, command }: ParsedArgv) {
  const itemMap: Record<string, number> = {}
  for (let i = 0; i < args.length; i++) {
    const name = args[i]
    if (!Item.data[name]) {
      return showItemSuggestions(command.name, session, args, i, next)
    }
    const nextArg = args[++i]
    if (nextArg === '*') {
      itemMap[name] = Infinity
    } else if (nextArg === '?') {
      itemMap[name] = itemMap[name] ?? -Infinity
    } else {
      const count = +args[i] * 0 === 0 ? +args[i] : (--i, 1)
      itemMap[name] = (itemMap[name] === -Infinity ? 0 : itemMap[name] || 0) + count
    }
  }
  return itemMap
}

type Condition = (user: ReadonlyUser, isLast: boolean) => boolean

interface Item {
  name: string
  rarity?: Item.Rarity
  description: string
  maxCount?: number
  value?: number
  bid?: number
  onGain?: Event
  onLose?: Event<'usage'>
  lottery?: number
  fishing?: number
  plot?: boolean
  condition?: Condition
}

namespace Item {
  export enum rarities { N, R, SR, SSR, EX, SP }
  export type Rarity = keyof typeof rarities

  type Items = Record<string, Item> & Item[] & Record<Rarity, Item[]>

  export const data: Items = [] as any

  data.N = []
  data.R = []
  data.SR = []
  data.SSR = []
  data.EX = []
  data.SP = []

  export const probabilities: Record<Rarity, number> = {
    N: 500,
    R: 300,
    SR: 150,
    SSR: 49,
    EX: 1,
    SP: 0,
  }

  export function load(item: Item) {
    if (!item.maxCount) item.maxCount = 10
    data[item.rarity].push(item)
    data[item.name] = item
    data.push(item)
  }

  export interface Config {
    createBuyer?: (user: User.Observed<'timers'>) => (name: string) => number
    createSeller?: (user: User.Observed<'timers'>) => (name: string) => number
  }

  export function pick(items: Item[], user: ReadonlyUser, isLast = false) {
    const weightEntries = items.filter(({ lottery, condition }) => {
      return lottery !== 0 && (!condition || condition(user, isLast))
    }).map(({ name, lottery }) => [name, lottery ?? 1] as const)
    const weight = Object.fromEntries(weightEntries)
    return Item.data[Random.weightedPick(weight)]
  }

  export function lose(session: Session<'usage' | 'warehouse'>, name: string, count = 1) {
    if (session.$user.warehouse[name]) {
      session.$user.warehouse[name] -= count
    }
    const item = Item.data[name]
    const result = item.onLose?.(session)
    if (result) return result
  }

  const MAX_RECENT_ITEMS = 10

  export function gain(session: Session<Adventurer.Field>, name: string, count = 1) {
    const item = Item.data[name]
    const output: string[] = []
    session.$user.gains[name] = (session.$user.gains[name] || 0) + count
    session.$user.warehouse[name] = (session.$user.warehouse[name] || 0) + count

    // update recent
    if (item.rarity !== 'SP') {
      const index = session.$user.recent.indexOf(name)
      if (index >= 0) {
        session.$user.recent.splice(index, 1)
      } else {
        session.$user.recent.splice(MAX_RECENT_ITEMS - 1, Infinity)
      }
      session.$user.recent.unshift(name)
    }

    // trigger event
    const result = item.onGain?.(session)
    if (result) output.push(result)

    return output.join('\n')
  }

  function getRarityIndex(name: string) {
    name = name.split('·')[0]
    return Item.data[name].rarity
  }

  export function format(names: string[]): void
  export function format(map: Record<string, number>, list?: string[]): void
  export function format(...args: [string[]] | [Record<string, number>, string[]?]) {
    if (Array.isArray(args[0])) {
      return args[0]
        .sort((a, b) => Item.rarities[getRarityIndex(a)] - Item.rarities[getRarityIndex(b)])
        .map(i => `${i}（${getRarityIndex(i)}）`)
        .join('，')
    } else {
      return (args[1] || Object.keys(args[0])).map(name => `${name}×${args[0][name]}`).join('，')
    }
  }

  export function checkOverflow(session: Session<Adventurer.Field>, names = Object.keys(session.$user.warehouse)) {
    const itemMap: Record<string, number> = {}
    for (const name of names) {
      const { maxCount, value } = Item.data[name]
      const overflow = session.$user.warehouse[name] - maxCount
      if (overflow > 0) {
        if (value && !checkTimer('$shop', session.$user)) {
          itemMap[name] = overflow
        } else {
          session.$user.warehouse[name] = maxCount
        }
      }
    }
    if (Object.keys(itemMap).length) {
      return '由于背包已满，' + Event.sell(itemMap)(session)
    }
  }

  export function apply(ctx: Context, config: Config) {
    ctx.on('parse', (message, { $reply, $prefix, $appel, subType }, builtin) => {
      if (!builtin || $reply || $prefix || (!$appel && subType === 'group') || !Item.data[message]) return
      return { command: 'show', args: [message], options: { pass: true } }
    })

    ctx.command('adventure/item [item]', '查看图鉴和物品', { maxUsage: 100 })
      .alias('show')
      .checkTimer('$system')
      .userFields(['id', 'warehouse', 'achievement', 'name', 'gains', 'authority'])
      .shortcut('查看图鉴')
      .shortcut('我的图鉴')
      .shortcut('查看背包')
      .shortcut('我的背包')
      .shortcut('查看物品')
      .shortcut('我的物品')
      .shortcut('查看仓库')
      .shortcut('我的仓库')
      .shortcut('查看道具')
      .shortcut('我的道具')
      .shortcut('物品', { fuzzy: true })
      .shortcut('查看', { fuzzy: true })
      .option('format', '/ <format> 以特定的格式输出', { type: 'string', hidden: true })
      .action(async ({ session, next, options }, name: string) => {
        const { warehouse, gains } = session.$user

        if (!name) {
          const achieved = Object.keys(warehouse).length
          const itemMap: Record<Item.Rarity, string[]> = { N: [], R: [], SR: [], SSR: [], EX: [], SP: [] }
          for (const item in warehouse) {
            itemMap[Item.data[item].rarity].push(item)
          }
          return [
            `${session.$username}，你已经获得过 ${Item.data.length} 件物品中的 ${achieved} 件。`,
            ...['N', 'R', 'SR', 'SSR', 'EX', 'SP'].map((rarity: Item.Rarity) => {
              const { length } = itemMap[rarity]
              let output = `${rarity} (${length}/${Item.data[rarity].length})`
              if (length) output += '：' + format(warehouse, itemMap[rarity])
              return output
            }),
            '要查看某件物品的介绍以及持有情况，请输入“四季酱，查看<物品名>”。',
          ].join('\n')
        }

        const item = Item.data[name]
        if (!item) return showItemSuggestions('show', session, [name], 0, next)
        if (Item.data[name] && !(name in warehouse)) return options['pass'] ? next() : '未获得过此物品。'

        if (session._redirected && options.format && Item.data[name]) {
          return options.format
            .replace(/%%/g, '@@__PLACEHOLDER__@@')
            .replace(/%n/g, name)
            .replace(/%r/g, item.rarity)
            .replace(/%c/g, '' + warehouse[name])
            .replace(/%g/g, '' + gains[name])
            .replace(/%m/g, '' + item.maxCount)
            .replace(/%d/g, '' + item.description)
        }

        const source: string[] = []
        const output = [`${item.name}（${item.rarity}）`]
        if (Item.data[name]) {
          output.push(`当前持有：${warehouse[name]} 件`)
          output.push(`累计获得：${gains[name]} 件`)
          output.push(`最大堆叠：${item.maxCount} 件`)
        }
        if (item.rarity !== 'SP' && item.lottery !== 0) source.push('抽奖')
        if ('fishing' in item) source.push('钓鱼')
        const value = config.createSeller(session.$user)(name)
        if (value) {
          output.push(`售出价格：${value}￥`)
        }
        const bid = config.createBuyer(session.$user)(name)
        if (bid) {
          source.push('商店')
          output.push(`购入价格：${bid}￥`)
        }
        if (item.plot || !source.length) source.push('剧情')
        output.push(`获取来源：${source.join(' / ')}`)
        output.push(item.description)
        return output.join('\n')
      })

    ctx.command('adventure/buy [item] [count]', '购入物品', { maxUsage: 100 })
      .checkTimer('$system')
      .checkTimer('$shop')
      .userFields(['id', 'authority', 'warehouse', 'money', 'wealth', 'achievement', 'timers', 'name', 'usage', 'progress', 'gains'])
      .shortcut('购入', { fuzzy: true })
      .shortcut('购买', { fuzzy: true })
      .shortcut('买入', { fuzzy: true })
      .before(session => checkTimer('$shop', session.$user))
      .action(async (argv, ...args) => {
        const { session } = argv
        const message = Phase.checkStates(session)
        if (message) return message
        if (session.$user.progress) return '检测到你有未完成的剧情，请尝试输入“继续当前剧情”。'

        const toBid = config.createBuyer(session.$user)
        if (!args.length) {
          const output = Item.data
            .map(i => ({ ...i, bid: toBid(i.name) }))
            .filter(p => p.bid)
            .sort((a, b) => a.bid > b.bid ? 1 : a.bid < b.bid ? -1 : Item.rarities[a.rarity] - Item.rarities[b.rarity])
            .map(p => `${p.name}（${p.rarity}） ${p.bid}￥`)
          output.unshift('物品名 购买价格')
          return output.join('\n')
        }

        const buyMap = await generateItemMap(argv)
        if (!buyMap) return

        let moneyLost = 0
        const user = session.$user
        for (const name in buyMap) {
          const count = buyMap[name]
          const { maxCount } = Item.data[name]
          const bid = toBid(name)
          if (!bid) return `物品“${name}”无法购入。`
          if (count === Infinity) {
            if (user.warehouse[name] >= maxCount) {
              delete buyMap[name]
              continue
            } else {
              buyMap[name] = maxCount - user.warehouse[name]
            }
          } else if (count === -Infinity) {
            if (user.warehouse[name]) {
              delete buyMap[name]
              continue
            } else {
              buyMap[name] = 1
            }
          } else {
            if (!isInteger(count) || count <= 0) return '数量错误。'
            if ((user.warehouse[name] || 0) + count > maxCount) return '数量超过持有上限。'
          }
          moneyLost += buyMap[name] * bid
          if (moneyLost > user.money) return '余额不足。'
        }

        const entries = Object.entries(buyMap)
        if (!entries.length) return '没有购买任何物品。'

        const hints = [Event.buy(buyMap)(session)]
        session.$app.emit('adventure/achieve', user as any, hints)

        await user._update()
        await session.$send(hints.join('\n'))
      })

    ctx.command('adventure/sell [item] [count]', '售出物品', { maxUsage: 100 })
      .checkTimer('$system')
      .checkTimer('$shop')
      .userFields(['id', 'authority', 'warehouse', 'money', 'wealth', 'achievement', 'timers', 'progress', 'name', 'usage', 'gains'])
      .shortcut('售出', { fuzzy: true })
      .shortcut('出售', { fuzzy: true })
      .shortcut('卖出', { fuzzy: true })
      .shortcut('售卖', { fuzzy: true })
      .action(async (argv, ...args) => {
        const { session } = argv
        const message = Phase.checkStates(session)
        if (message) return message
        if (session.$user.progress) return '检测到你有未完成的剧情，请尝试输入“继续当前剧情”。'

        const toValue = config.createSeller(session.$user)
        if (!args.length) {
          const output = Item.data
            .filter(p => p.value && session.$user.warehouse[p.name])
            .sort((a, b) => a.value > b.value ? 1 : a.value < b.value ? -1 : Item.rarities[a.rarity] - Item.rarities[b.rarity])
            .map(p => `${p.name}（${p.rarity}） ${toValue(p.name)}￥`)
          output.unshift('物品名 售出价格')
          return output.join('\n')
        }

        const sellMap = await generateItemMap(argv)
        if (!sellMap) return

        const user = session.$user
        for (const name in sellMap) {
          const count = sellMap[name]
          const { maxCount, value } = Item.data[name]
          if (!value) return `物品“${name}”无法售出。`
          if (count === Infinity) {
            if (user.warehouse[name]) {
              sellMap[name] = user.warehouse[name]
            } else {
              delete sellMap[name]
            }
          } else if (count === -Infinity) {
            if (user.warehouse[name] >= maxCount) {
              sellMap[name] = maxCount - user.warehouse[name] + 1
            } else {
              delete sellMap[name]
            }
          } else {
            if (!isInteger(count) || count <= 0) return '数量错误。'
            if ((user.warehouse[name] || 0) < count) return '剩余物品数量不足。'
          }
        }

        const entries = Object.entries(sellMap)
        if (!entries.length) return '没有出售任何物品。'

        if (checkTimer('$control', user) && Random.bool(0.25)) {
          let output = `${session.$username} 神志不清，手一滑丢弃了将要出售的${format(Object.keys(sellMap))}！`
          for (const name in sellMap) {
            const result = Item.lose(session, name, sellMap[name])
            if (result) output += '\n' + result
          }
          return output
        }

        let progress: string
        if (!user.progress && entries.length === 1 && entries[0][1] === 1 && entries[0][0] in Phase.salePlots) {
          const saleAction = Phase.salePlots[entries[0][0]]
          await session.$observeUser(Adventurer.fields)
          progress = getValue<string, Shopper.Field>(saleAction, user)
        }

        if (progress) {
          const _meta = session as Session<Adventurer.Field>
          _meta.$user['_skip'] = session._skipAll
          await Phase.setProgress(_meta.$user, progress)
          return Phase.start(_meta, config as any)
        }

        const hints = [Event.sell(sellMap)(session)]
        session.$app.emit('adventure/achieve', user as any, hints)
        await user._update()
        await session.$send(hints.join('\n'))
      })

    ctx.on('rank', (name) => {
      let isGain = false
      if (name.startsWith('累计')) {
        name = name.slice(2)
        isGain = true
      }
      return Item.data[name] && [isGain ? 'rank.gain' : 'rank.item', name]
    })

    ctx.rankCommand('rank.item [name]', '显示物品持有数量排行')
      .action(async ({ session, options, next }, name) => {
        if (!name) return '请输入物品名。'
        if (!Item.data[name]) return showItemSuggestions('rank.item', session, [name], 0, next)
        return Rank.show({
          names: ['持有' + name],
          value: `\`warehouse\`->'$."${name}"'`,
          format: ' 件',
        }, session, options)
      })

    ctx.rankCommand('rank.gain [name]', '显示物品累计获得数量排行')
      .action(async ({ session, options, next }, name) => {
        if (!name) return '请输入物品名。'
        if (!Item.data[name]) return showItemSuggestions('rank.gain', session, [name], 0, next)
        return Rank.show({
          names: ['累计获得' + name],
          value: `\`gains\`->'$."${name}"'`,
          format: ' 件',
        }, session, options)
      })
  }
}

export default Item
